import { FixtureMarkdown } from "./markdown";
import { FixtureIcon } from "./icons";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PluginAppDefinition, PluginSettingsSectionRegistration } from "@get-bb/plugin-sdk";
const rpc = {
  async call(method: string, input: unknown) {
    const scenario = new URLSearchParams(location.search).get("scenario") ?? "normal";
    const response = await fetch(
      `/fixture-rpc/${method}?scenario=${encodeURIComponent(scenario)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body.result;
  },
};
const signals = new EventTarget();
function FixtureNotifications() {
  useEffect(() => {
    let current = true;
    let cursor = 0;
    async function poll() {
      try {
        const response = await fetch(`/fixture-events?since=${cursor}`);
        if (response.ok) {
          const body = await response.json();
          if (!current) return;
          cursor = body.cursor;
          for (const signal of body.signals)
            signals.dispatchEvent(new CustomEvent(signal.channel, { detail: signal.payload }));
        }
      } catch {
        // The fixture models missed notifications. Explicit Reload still uses real RPC.
      }
      if (current) timer = setTimeout(poll, 500);
    }
    let timer = setTimeout(poll, 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, []);
  return null;
}
function FixtureDefault() {
  const [field, setField] = useState<{
    descriptor: { label: string; description?: string };
    value: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(value?: boolean) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/fixture-default?scenario=${encodeURIComponent(new URLSearchParams(location.search).get("scenario") ?? "normal")}`,
        value === undefined
          ? {}
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enableByDefault: value }),
            },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setField(body);
      for (const signal of body.signals)
        signals.dispatchEvent(new CustomEvent(signal.channel, { detail: signal.payload }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Default request failed");
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section
      className="code-cleanup-settings"
      aria-label="Fixture host setting"
      style={{ marginBottom: "1.5rem" }}
    >
      {field ? (
        <>
          <div className="cleanup-control">
            <span id="fixture-default-label">{field.descriptor.label}</span>
            <button
              role="switch"
              aria-labelledby="fixture-default-label"
              aria-checked={field.value}
              disabled={pending}
              onClick={() => void load(!field.value)}
            >
              {field.value ? "On" : "Off"}
            </button>
          </div>
          <p className="cleanup-help">{field.descriptor.description}</p>
        </>
      ) : (
        <p>Loading default setting…</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
// Implement only the public app hooks used by the actual app entry.
Object.assign(globalThis, {
  __bbPluginRuntime: {
    react: React,
    pluginSdkApp: {
      definePluginApp: (setup: PluginAppDefinition["setup"]): PluginAppDefinition => ({
        __bbPluginApp: true,
        setup,
      }),
      useRpc: () => rpc,
      useRealtimeConnectionState: () => "connected",
      useRealtime: (channel: string, handler: (payload: unknown) => void) =>
        useEffect(() => {
          const receive = (event: Event) => handler((event as CustomEvent).detail);
          signals.addEventListener(channel, receive);
          return () => signals.removeEventListener(channel, receive);
        }, [channel, handler]),
      Markdown: FixtureMarkdown,
      experimental_Icon: FixtureIcon,
    },
  },
});
const { default: app } = await import("../app");
let section: PluginSettingsSectionRegistration | undefined;
const collector = {
  slots: {
    settingsSection: (registration: PluginSettingsSectionRegistration) => {
      section = registration;
    },
  },
};
app.setup(collector as Parameters<PluginAppDefinition["setup"]>[0]);
if (!section) throw new Error("The actual app did not register Settings");
const Component = section.component;
createRoot(document.getElementById("app")!).render(
  <>
    <FixtureNotifications />
    <FixtureDefault />
    <h2>Project guidance</h2>
    <Component />
  </>,
);
