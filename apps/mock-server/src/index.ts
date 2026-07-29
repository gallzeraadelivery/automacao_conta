import { env } from "./env";
import { createApp } from "./app";

const app = createApp();

app.listen(env.MOCK_SERVER_PORT, () => {
  console.log(`Mock Uber server listening on port ${env.MOCK_SERVER_PORT} (${env.NODE_ENV})`);
  console.log(`  -> http://localhost:${env.MOCK_SERVER_PORT}/mock-uber/login`);
});
