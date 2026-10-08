import { AsyncLocalStorage } from "node:async_hooks";
export const actorContext = new AsyncLocalStorage<string>();
export const recordContext = new AsyncLocalStorage<Map<string, string>>();
