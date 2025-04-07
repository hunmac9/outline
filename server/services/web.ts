/* eslint-disable @typescript-eslint/no-var-requires */
import crypto from "crypto";
import { Server } from "https";
import Koa from "koa";
import compress from "koa-compress";
import {
  contentSecurityPolicy,
  dnsPrefetchControl,
  referrerPolicy,
} from "koa-helmet";
import mount from "koa-mount";
import enforceHttps, {
  httpsResolver,
  xForwardedProtoResolver,
} from "koa-sslify";
import { Second } from "@shared/utils/time";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import Metrics from "@server/logging/Metrics";
import ShutdownHelper, { ShutdownOrder } from "@server/utils/ShutdownHelper";
import { initI18n } from "@server/utils/i18n";
import routes from "../routes";
import api from "../routes/api";
import auth from "../routes/auth";

// Construct scripts CSP based on services in use by this installation
const defaultSrc = ["'self'"];
const scriptSrc = ["'self'", "www.googletagmanager.com"];
const styleSrc = ["'self'", "'unsafe-inline'"];

if (env.isCloudHosted) {
  scriptSrc.push("cdn.zapier.com");
  styleSrc.push("cdn.zapier.com");
}

// Allow to load assets from Vite
const viteHost = env.URL.replace(`:${env.PORT}`, ":3001"); // e.g., https://local.outline.dev:3001
if (!env.isProduction) {
  scriptSrc.push(viteHost);
  scriptSrc.push("localhost:3001");
  // Allow any host on port 3001 for LAN access during development
  scriptSrc.push("https://*:3001");
  scriptSrc.push("http://*:3001");
}

if (env.GOOGLE_ANALYTICS_ID) {
  scriptSrc.push("www.google-analytics.com");
}

if (env.CDN_URL) {
  scriptSrc.push(env.CDN_URL);
  styleSrc.push(env.CDN_URL);
  defaultSrc.push(env.CDN_URL);
}

export default function init(app: Koa = new Koa(), server?: Server) {
  void initI18n();

  if (env.isProduction) {
    // Force redirect to HTTPS protocol unless explicitly disabled
    if (env.FORCE_HTTPS) {
      app.use(
        enforceHttps({
          resolver: (ctx: Koa.Context) => {
            if (httpsResolver(ctx)) {
              return true;
            }
            return xForwardedProtoResolver(ctx);
          },
        })
      );
    } else {
      Logger.warn("Enforced https was disabled with FORCE_HTTPS env variable");
    }

    // trust header fields set by our proxy. eg X-Forwarded-For
    app.proxy = true;
  }

  app.use(compress());
  app.use(mount("/auth", auth));
  app.use(mount("/api", api));

  // Monitor server connections
  if (server) {
    setInterval(() => {
      server.getConnections((err: Error | null, count: number) => {
        if (err) {
          return;
        }
        Metrics.gaugePerInstance("connections.count", count);
      });
    }, 5 * Second.ms);
  }

  ShutdownHelper.add("connections", ShutdownOrder.normal, async () => {
    Metrics.gaugePerInstance("connections.count", 0);
  });

  // Sets common security headers by default, such as no-sniff, hsts, hide powered
  // by etc, these are applied after auth and api so they are only returned on
  // standard non-XHR accessed routes
  app.use((ctx: Koa.Context, next: Koa.Next) => {
    ctx.state.cspNonce = crypto.randomBytes(16).toString("hex");

    return contentSecurityPolicy({
      directives: {
        defaultSrc,
        styleSrc,
        scriptSrc: [
          ...scriptSrc,
          env.DEVELOPMENT_UNSAFE_INLINE_CSP
            ? "'unsafe-inline'"
            : `'nonce-${ctx.state.cspNonce}'`,
        ],
        mediaSrc: ["*", "data:", "blob:"],
        imgSrc: ["*", "data:", "blob:"],
        frameSrc: ["*", "data:"],
        // Do not use connect-src: because self + websockets does not work in
        // Safari, ref: https://bugs.webkit.org/show_bug.cgi?id=201591
        // Explicitly allow connections to Vite HMR server from any host during development
        connectSrc: env.isProduction
          ? ["*"]
          : [
              "'self'",
              viteHost, // e.g. https://local.outline.dev:3001
              "localhost:3001",
              "ws://localhost:3001", // Allow ws for localhost HMR
              "wss://localhost:3001", // Allow wss for localhost HMR
              "ws://*:3001", // Allow ws from any host for LAN HMR
              "wss://*:3001", // Allow wss from any host for LAN HMR
            ],
      },
    })(ctx, next);
  });

  // Allow DNS prefetching for performance, we do not care about leaking requests
  // to our own CDN's
  app.use(
    dnsPrefetchControl({
      allow: true,
    })
  );
  app.use(
    referrerPolicy({
      policy: "no-referrer",
    })
  );

  app.use(mount(routes));

  return app;
}
