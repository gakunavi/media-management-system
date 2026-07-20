import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** 設計書 §8: owner | partner | readonly */
      role: string;
    } & DefaultSession["user"];
  }
}

export {};
