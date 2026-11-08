# Magpie model connection

This ordinary companion plugin connects to an independently operated Magpie gateway through the existing native Responses transport. It does not install, bundle, start or manage Magpie, import accounts, or read DSH credentials.

Configuration is `baseUrl`, explicit `model`, and `authMode`. The default loopback base is `http://127.0.0.1:3425/v1`; the empty model is unconfigured. `local-client-id` uses a public app label and is allowed only on localhost, 127.0.0.1 or ::1. Remote gateways require HTTPS and an independently supplied gateway key. Keys stay in a host-private process slot or operator environment, not plugin Config.

The service supplies `createMagpieConnectionPlugin(portsFor)`. Third-party connection plugins use the same ordinary lifecycle and native port; the generic default export cannot invent host authority. Saving/applying does no inference. An explicit check uses actual native SSE; model presence, a key or an active plugin is not verification.
