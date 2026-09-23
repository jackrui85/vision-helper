import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Camera,
  Check,
  Bell,
  BellRing,
  CheckCheck,
  Download,
  Eye,
  FileImage,
  ImagePlus,
  LoaderCircle,
  Mic,
  Play,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Mode = "scene" | "text" | "object";
type HistoryItem = { id: number; time: string; mode: Mode; description: string };
type NotificationItem = { id: number; title: string; message: string; time: string; read: boolean; kind: "result" | "system" | "custom" };
type NotificationSettings = { enabled: boolean; result: boolean; camera: boolean; sound: boolean; browser: boolean };

const modeLabels: Record<Mode, { label: string; hint: string }> = {
  scene: { label: "描述場景", hint: "整體畫面與安全提醒" },
  text: { label: "讀取文字", hint: "優先辨識招牌、文件與螢幕" },
  object: { label: "尋找物件", hint: "物件名稱與大概位置" },
};

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function resizeImage(source: string, maxSize = 1600): Promise<string> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return resolve(source);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("scene");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({ enabled: true, result: true, camera: true, sound: true, browser: false });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanInFlightRef = useRef(false);
  const analyzeMutation = trpc.vision.analyze.useMutation();

  useEffect(() => {
    try {
      const savedNotifications = window.localStorage.getItem("vision-helper-notifications");
      const savedSettings = window.localStorage.getItem("vision-helper-notification-settings");
      if (savedNotifications) setNotifications(JSON.parse(savedNotifications) as NotificationItem[]);
      if (savedSettings) setNotificationSettings({ ...notificationSettings, ...(JSON.parse(savedSettings) as Partial<NotificationSettings>) });
    } catch { /* 使用預設通知設定 */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("vision-helper-notifications", JSON.stringify(notifications.slice(0, 30)));
  }, [notifications]);

  useEffect(() => {
    window.localStorage.setItem("vision-helper-notification-settings", JSON.stringify(notificationSettings));
  }, [notificationSettings]);

  const speak = useCallback((text: string) => {
    if (!text || !("speechSynthesis" in window)) {
      toast.error("此瀏覽器不支援語音朗讀");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-TW";
    utterance.rate = 0.94;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const pushNotification = useCallback((title: string, message: string, kind: NotificationItem["kind"] = "system") => {
    if (!notificationSettings.enabled || (kind === "result" && !notificationSettings.result) || (kind === "system" && !notificationSettings.camera)) return;
    const item = { id: Date.now(), title, message, time: formatTime(), read: false, kind };
    setNotifications(items => [item, ...items].slice(0, 30));
    toast(title, { description: message });
    if (notificationSettings.sound && kind === "system") speak(`${title}。${message}`);
    if (notificationSettings.browser && "Notification" in window && Notification.permission === "granted") new Notification(title, { body: message });
  }, [notificationSettings, speak]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const addHistory = useCallback((text: string, selectedMode: Mode) => {
    setHistory(items => [
      { id: Date.now(), time: formatTime(), mode: selectedMode, description: text },
      ...items,
    ].slice(0, 20));
  }, []);

  const analyzeImage = useCallback(async (source: string, selectedMode: Mode, shouldSpeak = true) => {
    if (scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    try {
      const optimized = await resizeImage(source);
      setImageUrl(optimized);
      const result = await analyzeMutation.mutateAsync({ imageDataUrl: optimized, mode: selectedMode });
      setDescription(result.description);
      setLastScanAt(new Date());
      addHistory(result.description, selectedMode);
      if (shouldSpeak) speak(result.description);
    } catch (error) {
      const message = error instanceof Error ? error.message : "辨識時發生問題，請再試一次。";
      toast.error(message);
      setDescription("目前無法完成辨識，請確認網路連線與圖片清晰度後再試一次。");
    } finally {
      scanInFlightRef.current = false;
    }
  }, [addHistory, analyzeMutation, speak]);

  const captureFrame = useCallback((shouldSpeak = true) => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      toast.error("相機畫面尚未準備好");
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    void analyzeImage(canvas.toDataURL("image/jpeg", 0.82), mode, shouldSpeak);
  }, [analyzeImage, mode]);

  const startCamera = useCallback(async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("此瀏覽器不支援相機功能，請改用圖片上傳。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraOn(true);
      toast.success("相機已啟用，可以開始辨識");
      pushNotification("相機已啟用", "現在可以按下立即辨識或開啟自動辨識。", "system");
    } catch {
      setCameraError("無法存取相機。請在瀏覽器允許相機權限，或使用圖片上傳。");
    }
  }, [pushNotification]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraOn(false);
    setAutoScan(false);
    pushNotification("相機已關閉", "已停止即時影像預覽。", "system");
  }, [pushNotification]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (!isCameraOn || !autoScan) return;
    const interval = window.setInterval(() => captureFrame(true), 9000);
    return () => window.clearInterval(interval);
  }, [autoScan, captureFrame, isCameraOn]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (isCameraOn) captureFrame(true);
        else fileInputRef.current?.click();
      }
      if (event.key.toLowerCase() === "r" && description) speak(description);
      if (event.key.toLowerCase() === "s" && isSpeaking) stopSpeaking();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureFrame, description, isCameraOn, isSpeaking, speak, stopSpeaking]);

  const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("請選擇 JPG、PNG 或其他圖片檔案");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") void analyzeImage(reader.result, mode, true);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const downloadHistory = () => {
    if (!history.length && !description) {
      toast.error("目前沒有可匯出的辨識紀錄");
      return;
    }
    const items = history.length ? history : [{ id: Date.now(), time: formatTime(), mode, description }];
    const content = [
      "視覺助手｜影像辨識文字紀錄",
      `匯出時間：${new Date().toLocaleString("zh-TW")}`,
      "",
      ...items.map((item, index) => `${index + 1}. [${item.time}] ${modeLabels[item.mode].label}\n${item.description}`),
    ].join("\n\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `視覺助手-辨識紀錄-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("文字紀錄已下載");
  };

  const clearResult = () => {
    setDescription("");
    setImageUrl(null);
    setLastScanAt(null);
    stopSpeaking();
  };

  const unreadCount = notifications.filter(item => !item.read).length;
  const markNotificationsRead = () => setNotifications(items => items.map(item => ({ ...item, read: true })));
  const updateNotificationSetting = (key: keyof NotificationSettings, value: boolean) => {
    setNotificationSettings(settings => ({ ...settings, [key]: value }));
    if (key === "browser" && value && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  };
  const sendCustomNotification = () => {
    const title = customTitle.trim() || "自訂提醒";
    const message = customMessage.trim();
    if (!message) {
      toast.error("請先輸入通知內容");
      return;
    }
    const item = { id: Date.now(), title, message, time: formatTime(), read: false, kind: "custom" as const };
    setNotifications(items => [item, ...items].slice(0, 30));
    toast(title, { description: message });
    setCustomTitle("");
    setCustomMessage("");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><Eye size={25} strokeWidth={2.4} /></div>
          <div><p className="eyebrow">VISION HELPER · 影像理解工具</p><h1>視覺助手</h1></div>
        </div>
        <div className="topbar-tools">
          <button className={`notification-trigger ${notificationsOpen ? "active" : ""}`} onClick={() => { setNotificationsOpen(open => !open); markNotificationsRead(); }} aria-expanded={notificationsOpen} aria-controls="notification-panel">
            {unreadCount ? <BellRing size={18} /> : <Bell size={18} />}<span>通知</span>{unreadCount > 0 && <b>{unreadCount > 9 ? "9+" : unreadCount}</b>}
          </button>
          <div className="topbar-status"><span className="status-dot" />語音優先 · 繁體中文</div>
        </div>
      </header>

      {notificationsOpen && <aside className="notification-panel" id="notification-panel" aria-label="通知中心">
        <div className="notification-panel-head"><div><p className="panel-index">NOTIFICATION CENTER</p><h3>自訂通知</h3></div><button className="close-notifications" onClick={() => setNotificationsOpen(false)} aria-label="關閉通知中心"><X size={18} /></button></div>
        <p className="notification-intro">設定辨識完成、相機狀態與自訂提醒，讓重要資訊不會錯過。</p>
        <div className="notification-settings">
          <label className="setting-row"><span><strong>啟用通知中心</strong><small>在此裝置保存最近 30 則通知</small></span><input type="checkbox" checked={notificationSettings.enabled} onChange={event => updateNotificationSetting("enabled", event.target.checked)} /></label>
          <label className="setting-row"><span><strong>辨識完成提示</strong><small>每次影像辨識完成時提醒</small></span><input type="checkbox" checked={notificationSettings.result} disabled={!notificationSettings.enabled} onChange={event => updateNotificationSetting("result", event.target.checked)} /></label>
          <label className="setting-row"><span><strong>相機狀態提示</strong><small>開啟或關閉相機時提醒</small></span><input type="checkbox" checked={notificationSettings.camera} disabled={!notificationSettings.enabled} onChange={event => updateNotificationSetting("camera", event.target.checked)} /></label>
          <label className="setting-row"><span><strong>通知語音</strong><small>用語音讀出系統通知</small></span><input type="checkbox" checked={notificationSettings.sound} disabled={!notificationSettings.enabled} onChange={event => updateNotificationSetting("sound", event.target.checked)} /></label>
          <label className="setting-row"><span><strong>瀏覽器通知</strong><small>離開頁面時仍顯示桌面提示</small></span><input type="checkbox" checked={notificationSettings.browser} disabled={!notificationSettings.enabled} onChange={event => updateNotificationSetting("browser", event.target.checked)} /></label>
        </div>
        <div className="custom-notification-form"><p className="form-label">建立自訂提醒</p><input value={customTitle} onChange={event => setCustomTitle(event.target.value)} placeholder="通知標題（選填）" aria-label="通知標題" /><textarea value={customMessage} onChange={event => setCustomMessage(event.target.value)} placeholder="例如：記得確認出口方向" rows={2} aria-label="通知內容" /><button className="button button-accent" onClick={sendCustomNotification}><Send size={17} />加入通知</button></div>
        <div className="notification-list-head"><span>最近通知</span><button onClick={markNotificationsRead}><CheckCheck size={15} />全部標為已讀</button></div>
        <div className="notification-list">{notifications.length === 0 ? <div className="notification-empty"><Bell size={20} /><span>目前沒有通知</span></div> : notifications.slice(0, 8).map(item => <article className={`notification-item ${item.read ? "read" : ""}`} key={item.id}><span className={`notification-kind ${item.kind}`} /><div><strong>{item.title}</strong><p>{item.message}</p><small>{item.time}</small></div></article>)}</div>
      </aside>}

      <section className="hero-block" aria-labelledby="page-title">
        <div>
          <p className="section-kicker"><Sparkles size={16} />讓眼前的畫面，變成聽得見的資訊</p>
          <h2 id="page-title">看不見，也能掌握<br /><span>當下發生什麼事。</span></h2>
          <p className="hero-copy">使用相機或上傳圖片，取得簡潔的場景描述、文字辨識與物件位置說明。每次結果都能立即朗讀，亦可匯出成文字檔保存。</p>
        </div>
        <div className="hero-note" role="note"><ShieldCheck size={20} /><div><strong>設計給輔助使用</strong><span>大字體 · 高對比 · 鍵盤可操作</span></div></div>
      </section>

      <div className="workspace-grid">
        <section className="capture-card panel" aria-labelledby="capture-title">
          <div className="panel-heading"><div><p className="panel-index">01 · INPUT</p><h3 id="capture-title">提供一張畫面</h3></div><span className={`live-pill ${isCameraOn ? "live" : ""}`}><span />{isCameraOn ? "相機運作中" : "等待輸入"}</span></div>
          <div className={`media-stage ${imageUrl ? "has-image" : ""}`}>
            <video ref={videoRef} className={isCameraOn ? "visible" : ""} playsInline muted aria-label="相機即時預覽" />
            {imageUrl && !isCameraOn && <img src={imageUrl} alt="目前選取的待辨識圖片" />}
            {!isCameraOn && !imageUrl && <div className="empty-media"><div className="media-icon"><ScanLine size={30} /></div><strong>還沒有影像</strong><span>開啟相機或上傳一張圖片開始</span></div>}
            {isCameraOn && <div className="camera-guide" aria-hidden="true"><i /><i /><i /><i /></div>}
            {analyzeMutation.isPending && <div className="analyzing-overlay"><LoaderCircle className="spin" size={28} /><span>正在理解畫面…</span></div>}
          </div>
          {cameraError && <p className="error-message" role="alert">{cameraError}</p>}
          <input ref={fileInputRef} className="sr-only" type="file" accept="image/*" onChange={onFileSelected} aria-label="選擇圖片檔案" />
          <div className="input-actions"><button className="button button-primary" onClick={() => void startCamera()} disabled={isCameraOn}><Camera size={20} />開啟相機</button><button className="button button-outline" onClick={() => fileInputRef.current?.click()}><ImagePlus size={20} />上傳圖片</button>{isCameraOn && <button className="button button-dark" onClick={stopCamera}><StopCircle size={20} />關閉相機</button>}</div>
          <div className="camera-actions"><button className="button button-accent" disabled={!isCameraOn || analyzeMutation.isPending} onClick={() => captureFrame(true)}><ScanLine size={19} />立即辨識 <kbd>空白鍵</kbd></button><label className={`auto-toggle ${autoScan ? "checked" : ""}`}><input type="checkbox" checked={autoScan} disabled={!isCameraOn} onChange={event => setAutoScan(event.target.checked)} /><span className="toggle-track"><span /></span><span>每 9 秒自動辨識</span></label></div>
          <p className="help-text">提示：按 <kbd>空白鍵</kbd> 立即辨識 · 按 <kbd>R</kbd> 重播語音 · 按 <kbd>S</kbd> 停止語音</p>
        </section>

        <section className="result-card panel" aria-labelledby="result-title" aria-live="polite">
          <div className="panel-heading"><div><p className="panel-index">02 · OUTPUT</p><h3 id="result-title">聽見與閱讀結果</h3></div>{lastScanAt && <span className="result-time"><Check size={15} />{formatTime(lastScanAt)} 完成</span>}</div>
          <div className={`result-body ${description ? "filled" : ""}`}>{!description ? <div className="empty-result"><div className="audio-orb"><Volume2 size={28} /></div><strong>辨識結果會出現在這裡</strong><span>完成辨識後，請使用下方按鈕朗讀</span></div> : <><div className="result-label"><span className="result-bar" />AI 影像說明</div><p className="description-text">{description}</p></>}</div>
          <div className="result-actions"><button className="button button-primary wide" disabled={!description || isSpeaking} onClick={() => speak(description)}><Volume2 size={20} />{isSpeaking ? "正在朗讀…" : "朗讀結果"}</button><button className="button button-outline icon-button" disabled={!isSpeaking} onClick={stopSpeaking} aria-label="停止朗讀"><VolumeX size={20} /><span className="sr-only">停止朗讀</span></button><button className="button button-ghost icon-button" disabled={!description} onClick={clearResult} aria-label="清除結果"><X size={20} /><span className="sr-only">清除結果</span></button></div>
          <div className="mode-selector" aria-label="辨識模式"><span>辨識模式</span>{(Object.keys(modeLabels) as Mode[]).map(item => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{modeLabels[item].label}<small>{modeLabels[item].hint}</small></button>)}</div>
        </section>
      </div>

      <section className="history-section" aria-labelledby="history-title"><div className="history-heading"><div><p className="panel-index">03 · LOG</p><h3 id="history-title">最近辨識紀錄</h3></div><button className="button button-outline" disabled={!history.length && !description} onClick={downloadHistory}><Download size={18} />下載文字檔</button></div>{!history.length ? <div className="history-empty"><FileImage size={22} /><span>完成第一次辨識後，結果會自動保留在這裡。</span></div> : <div className="history-list">{history.map(item => <article className="history-item" key={item.id}><div className="history-meta"><span>{item.time}</span><strong>{modeLabels[item.mode].label}</strong></div><p>{item.description}</p><button className="history-play" onClick={() => speak(item.description)} aria-label={`朗讀 ${item.time} 的辨識結果`}><Play size={16} fill="currentColor" /></button></article>)}</div>}</section>
      <footer className="footer-note"><span><Mic size={15} />所有語音朗讀在你的瀏覽器本機執行</span><span>辨識內容僅用於本次操作</span></footer>
    </main>
  );
}
