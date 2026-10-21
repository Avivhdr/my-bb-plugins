// Synthetic native controls for the built-plugin check. No microphone, audio,
// network request, or real conversation is used here.
export function installVoiceFixture({ form, input, commands, version = "0.44" }) {
  const mic = form.querySelector('[aria-label="Start voice input"]');
  const command = commands.find((command) => command.id === "start-voice-input");
  const context = { threadId: "fixture", projectId: "fixture", openPanel: () => false };
  let binding = command.defaultShortcut;
  let starts = 0,
    confirms = 0,
    cancels = 0;
  let voiceSends = 0;
  let controls;
  const state = () =>
    form.hasAttribute("data-promptbox-voice-active")
      ? controls.querySelectorAll("button")[1].disabled
        ? "transcribing"
        : "recording"
      : "idle";
  function finish(text = "") {
    form.removeAttribute("data-promptbox-voice-active");
    controls?.remove();
    controls = null;
    input.readOnly = false;
    input.removeAttribute("aria-readonly");
    mic.hidden = false;
    if (text) input.value += ` ${text}`;
  }
  function recording(transcribing = false, sending = false) {
    form.setAttribute("data-promptbox-voice-active", "");
    input.readOnly = true;
    input.setAttribute("aria-readonly", "true");
    mic.hidden = true;
    controls ??= document.createElement("div");
    controls.setAttribute("data-promptbox-voice-controls", "");
    controls.dataset.voiceTransition = "active";
    const draftLabel =
      version === "0.45" ? "Stop and add to draft" : "Stop and transcribe recording";
    controls.innerHTML = `<button type="button" aria-label="${transcribing ? "Cancel transcription" : "Cancel recording"}">Cancel</button>
      <span>${transcribing ? "Transcribing" : "Synthetic recording"}</span>
      <button type="button" aria-label="${transcribing && !sending ? "Transcribing voice input" : draftLabel}" ${transcribing ? "disabled" : ""}>Confirm</button>
      ${version === "0.45" ? `<button type="button" aria-label="${sending ? "Transcribing and sending" : "Send voice input"}" ${transcribing ? "disabled" : ""}>Send voice</button>` : ""}`;
    form.querySelector("[data-promptbox-action-row]").append(controls);
    controls.querySelector("button").onclick = () => {
      cancels++;
      finish();
    };
    controls.querySelectorAll("button")[1].onclick = () => {
      confirms++;
      recording(true);
    };
    const send = controls.querySelector('[aria-label="Send voice input"]');
    if (send)
      send.onclick = () => {
        voiceSends++;
        recording(true, true);
      };
  }
  mic.onclick = () => {
    starts++;
    recording();
  };
  // This is a fixture host-command dispatcher, not plugin runtime code. Change
  // binding to exercise rebinding/disabled behavior without a hard-coded plugin listener.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || !binding) return;
    const key = event.key === " " ? "Space" : event.key;
    if (
      key !== binding.key ||
      event.ctrlKey !== !!binding.control ||
      event.shiftKey !== !!binding.shift ||
      event.metaKey !== !!binding.meta ||
      event.altKey !== !!binding.alt
    )
      return;
    if (!command.isAvailable(context)) return;
    event.preventDefault();
    command.run(context);
  });
  input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.defaultPrevented &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  // Simulate native cancellation. The plugin leaves this listener unchanged.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && state() !== "idle") {
        event.preventDefault();
        cancels++;
        finish();
      }
    },
    true,
  );
  input.value = "Keep my draft";
  input.focus();
  return {
    get starts() {
      return starts;
    },
    get confirms() {
      return confirms;
    },
    get voiceSends() {
      return voiceSends;
    },
    get cancels() {
      return cancels;
    },
    get state() {
      return state();
    },
    finish,
    bind(next) {
      binding = next;
    },
  };
}
