import { app } from "./app";

export default {
  async fetch(request: Request): Promise<Response> {
    return app.fetch(request);
  },
};
