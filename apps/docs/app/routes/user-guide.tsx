import { loadGuidePage } from "../lib/load-guide-page";

export { default, meta } from "./guide";

export async function clientLoader(args: { request: Request }) {
  return loadGuidePage(args);
}
