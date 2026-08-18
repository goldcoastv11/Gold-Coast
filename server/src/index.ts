import { app } from "./app";
import { env } from "./env";

app.listen(env.PORT, () => {
  console.log(`casino-poc server listening on http://localhost:${env.PORT}`);
});
