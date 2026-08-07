import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

let configured = false;

export function configureAiNetworkFromEnv() {
  if (configured) {
    return;
  }

  const explicitAiProxy = process.env.AI_HTTPS_PROXY?.trim();
  const hasStandardProxy = [
    process.env.HTTP_PROXY,
    process.env.HTTPS_PROXY,
    process.env.http_proxy,
    process.env.https_proxy,
  ].some((value) => Boolean(value?.trim()));

  if (explicitAiProxy) {
    setGlobalDispatcher(
      new EnvHttpProxyAgent({
        httpProxy: explicitAiProxy,
        httpsProxy: explicitAiProxy,
        noProxy:
          process.env.AI_NO_PROXY?.trim() ||
          process.env.NO_PROXY?.trim() ||
          process.env.no_proxy?.trim(),
      }),
    );
  } else if (hasStandardProxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }

  configured = true;
}
