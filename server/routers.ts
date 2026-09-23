import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  vision: router({
    analyze: publicProcedure
      .input(z.object({
        imageDataUrl: z.string().min(32).max(9_000_000),
        mode: z.enum(["scene", "text", "object"]).default("scene"),
      }))
      .mutation(async ({ input }) => {
        const modeInstruction = {
          scene: "描述整個畫面、重要物件、人物、方向與可能的安全提醒。",
          text: "優先讀取並整理畫面中的文字；看不清楚時請明確說明，不要猜測。",
          object: "列出畫面中最重要的物件，並用簡短語句說明它們大概的位置。",
        }[input.mode];
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "你是給視障使用者使用的影像描述助手。請使用繁體中文、先講最重要的資訊、語氣自然簡潔。不要臆測身份、年齡或無法確認的細節；不確定時請說不確定。回答控制在 4 到 7 句，適合直接用語音朗讀。" },
            { role: "user", content: [
              { type: "text", text: modeInstruction },
              { type: "image_url", image_url: { url: input.imageDataUrl, detail: "auto" } },
            ] },
          ],
        });
        const content = response.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim()) return { description: content.trim() };
        if (Array.isArray(content)) {
          const text = content.filter(part => part.type === "text").map(part => part.text).join(" ").trim();
          if (text) return { description: text };
        }
        throw new Error("模型沒有回傳可讀取的描述");
      }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
