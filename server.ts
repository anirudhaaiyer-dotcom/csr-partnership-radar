import { geminiModel } from './gemini';
import { getRepo } from './repo';

export const repo = () => getRepo();
export const model = () => geminiModel({ GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL });
export const appEnv = () => ({
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  DIGEST_FROM: process.env.DIGEST_FROM,
  DIGEST_TO: process.env.DIGEST_TO,
  APP_URL: process.env.APP_URL,
});
