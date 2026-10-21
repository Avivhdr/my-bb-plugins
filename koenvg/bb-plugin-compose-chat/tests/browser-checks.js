// Run only on the labeled local fixture, never a live BB thread.
export function runChecks() {
  if (document.title !== "Compose Chat fixture" || !window.fixture?.ready) {
    throw new Error("Expected the isolated Compose Chat fixture");
  }
  const passed = [];
  function check(name, value) {
    if (!value) throw new Error(name);
    passed.push(name);
  }
  const root = document.documentElement;
  const { form, originalInput: field, submit } = window.fixture;
  const styleToggle = document.getElementById("toggle-style");
  const mode = root.dataset.layout;
  const footer = document.querySelector("[data-follow-up-composer-footer]");
  const nativeHidden = Boolean(footer && (mode === "compact" || innerWidth <= 767));
  const frame =
    mode === "compact" ? form : document.querySelector("[data-follow-up-composer]") || form;
  const unrelated = document.querySelector(".unrelated");
  const unrelatedStyle = getComputedStyle(unrelated).backgroundColor;
  const font = getComputedStyle(field).fontFamily;
  const draft = field.value;
  const retainedDraft = draft || "Keep my @literal /literal draft";
  if (new URLSearchParams(location.search).has("long"))
    check("long native draft is present", draft.length > 400);
  const nativeChildren = () =>
    [...document.body.querySelectorAll("*")].filter(
      (el) => !el.closest("[data-compose-speed-owned]"),
    );
  const children = nativeChildren();
  const liveLabel = document.querySelector(
    '[data-timeline-row-id="fixture:tools:1"] .animate-shine',
  );
  const thinkingLabel = document.querySelector(
    '[data-timeline-row-id="fixture:thinking:1"] .animate-shine',
  );
  const historicalLabel = document.querySelector(".thought .leading-5 > span");
  const statusLabel = document.querySelector(".work-status .animate-shine");
  const lattice = () => getComputedStyle(liveLabel, "::before");
  check("native inline tool label stays readable", liveLabel.textContent === "Running 3 tools");
  check(
    "inline tools have a decorative lattice",
    lattice().content === '""' && lattice().width === "4px",
  );
  check(
    "inline Thinking has a lattice",
    getComputedStyle(thinkingLabel, "::before").content === '""',
  );
  check(
    "historical thinking rows have no lattice",
    getComputedStyle(historicalLabel, "::before").content === "none",
  );
  check(
    "standalone composer status has no lattice",
    getComputedStyle(statusLabel, "::before").content === "none",
  );
  check(
    "standalone shimmer stays native",
    getComputedStyle(statusLabel).maskImage.includes("fixture-shine.svg"),
  );
  for (const label of [liveLabel, thinkingLabel]) {
    const labelStyle = getComputedStyle(label);
    check(
      "inline label removes native animated mask",
      labelStyle.maskImage === "none" && labelStyle.webkitMaskImage === "none",
    );
    check("inline label releases native compositor hint", labelStyle.willChange === "auto");
  }
  const details = thinkingLabel.closest("details");
  details.querySelector("summary").click();
  check("native Thinking expansion is preserved", details.open);
  details.querySelector("summary").click();
  check("native Thinking collapse is preserved", !details.open);
  liveLabel.classList.remove("animate-shine");
  check("completion removes the inline lattice", lattice().content === "none");
  liveLabel.classList.add("animate-shine");
  check("running again restores the inline lattice", lattice().content === '""');
  check(
    "lattice uses the native 20px icon/text column",
    parseFloat(lattice().width) + parseFloat(lattice().marginInlineEnd) === 20,
  );
  const bundle = document.querySelector('[data-timeline-row-list="bundle"]');
  const childIcon = bundle.querySelector('[data-timeline-row-id="fixture:tool:2"] button svg');
  const childLabel = bundle.querySelector(
    '[data-timeline-row-id="fixture:tool:2"] button .leading-5',
  );
  const titleText = document.createRange();
  titleText.selectNodeContents(liveLabel);
  const titleTextX = titleText.getBoundingClientRect().x;
  check(
    "bundle children have one logical indentation level",
    parseFloat(getComputedStyle(bundle).paddingInlineStart) === 20,
  );
  check(
    "child icon aligns beneath the heading text",
    Math.abs(childIcon.getBoundingClientRect().x - titleTextX) < 1,
  );
  check(
    "child label sits one column beneath the heading",
    Math.abs(childLabel.getBoundingClientRect().x - titleTextX - 20) < 1,
  );
  const completedTextX = childLabel.getBoundingClientRect().x;
  for (const id of ["fixture:tool:1", "fixture:tool:3"]) {
    const runningChild = bundle.querySelector(`[data-timeline-row-id="${id}"]`);
    const runningGlyph = runningChild.querySelector("[data-icon-root]");
    const runningLabel = runningChild.querySelector(".animate-shine");
    const runningText = document.createRange();
    runningText.selectNodeContents(runningLabel);
    const kind = runningGlyph.hasAttribute("data-plugin-icon-asset") ? "plugin-mask" : "SVG";
    check(
      `${kind} active tool uses one icon column, not two`,
      getComputedStyle(runningGlyph).display === "none",
    );
    check(
      `${kind} active and completed text columns align`,
      Math.abs(runningText.getBoundingClientRect().x - completedTextX) < 1,
    );
    runningLabel.classList.remove("animate-shine");
    check(
      `${kind} completion restores the native glyph`,
      getComputedStyle(runningGlyph).display !== "none",
    );
    check(
      `${kind} completion does not shift the text column`,
      Math.abs(runningText.getBoundingClientRect().x - completedTextX) < 1,
    );
    runningLabel.classList.add("animate-shine");
  }
  check(
    "top-left lattice dot has a visible fill",
    getComputedStyle(liveLabel, "::before").backgroundColor !== "rgba(0, 0, 0, 0)",
  );
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  check(
    "lattice respects the motion preference",
    lattice().animationName === (reduceMotion ? "none" : "compose-lattice-arrow"),
  );
  const nativeText = liveLabel.textContent;
  const beforeDisableLabelWidth = liveLabel.getBoundingClientRect().width;

  check(
    "built entry mounted the scoped style owner",
    root.getAttribute("data-compose-chat") === "active",
  );
  const formShadow = getComputedStyle(form).boxShadow;
  const sharedShadow = getComputedStyle(frame).boxShadow;
  check(
    "composer has no resting dark outline",
    getComputedStyle(form).outlineStyle === "none" &&
      getComputedStyle(frame).outlineStyle === "none",
  );
  if (mode === "expanded") {
    check("expanded frame owns the soft shadow", sharedShadow !== "none" && formShadow === "none");
  } else check("standalone composer has a soft shadow", formShadow !== "none");
  if (mode === "new")
    check(
      "joined footer has an outward soft shadow",
      getComputedStyle(form.nextElementSibling).boxShadow !== "none",
    );
  check(
    "theme-derived composer geometry",
    parseFloat(getComputedStyle(frame).borderTopLeftRadius) ===
      parseFloat(getComputedStyle(root).getPropertyValue("--radius")) + 6,
  );
  if (nativeHidden)
    check("native hidden footer stays hidden", getComputedStyle(footer).opacity === "0");
  if (mode === "compact")
    check(
      "compact form stays independently framed",
      getComputedStyle(form).borderTopWidth === "1px",
    );
  if (mode === "new")
    check(
      "new-thread frame joins the native footer",
      getComputedStyle(form).borderBottomLeftRadius === "0px",
    );
  if (mode === "expanded" && !nativeHidden)
    check(
      "follow-up footer has its hairline divider",
      getComputedStyle(footer).borderTopWidth === "1px",
    );

  function luminance(color) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
      .slice(0, 3)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  function contrast(foreground, background) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  }
  const bodyStyle = getComputedStyle(document.body);
  const bodyContrast = contrast(bodyStyle.color, bodyStyle.backgroundColor);
  const placeholderContrast = contrast(
    getComputedStyle(field, "::placeholder").color,
    getComputedStyle(frame).backgroundColor,
  );
  check("body text contrast is at least 4.5:1", bodyContrast >= 4.5);
  check("placeholder contrast is at least 4.5:1", placeholderContrast >= 4.5);
  const split = window.fixture.nativeSplit;
  function checkSplitGeometry() {
    if (!split) return;
    const { options } = split;
    const expectedOptionsWidth = field.value.trim() ? 24 : 0;
    check(
      "split-send fixture uses native collapsed/visible width",
      split.optionsWidth === expectedOptionsWidth,
    );
    check(
      "native send options width is preserved",
      options.getBoundingClientRect().width === split.optionsWidth,
    );
    check(
      "native split primary width is preserved",
      submit.getBoundingClientRect().width === split.submitWidth,
    );
    check(
      "native split primary height is preserved",
      submit.getBoundingClientRect().height === split.submitHeight,
    );
    check(
      "native compound width is preserved",
      split.split.getBoundingClientRect().width === split.compoundWidth,
    );
    check(
      "native compound corner geometry is preserved",
      getComputedStyle(submit).borderTopRightRadius === split.submitRightRadius,
    );
    check(
      "collapsed options cannot reveal the chevron",
      !options.hasAttribute("aria-hidden") ||
        (options.getBoundingClientRect().width === 0 &&
          getComputedStyle(options).overflow === "hidden"),
    );
  }
  checkSplitGeometry();
  const minimum = matchMedia("(pointer: coarse)").matches ? 44 : 32;
  for (const button of form.querySelectorAll("[data-promptbox-action-row] button")) {
    if (button.closest("[data-promptbox-send-menu]")) continue;
    const box = button.getBoundingClientRect();
    check(`hit area height for ${button.getAttribute("aria-label")}`, box.height >= minimum);
    check(`hit area width for ${button.getAttribute("aria-label")}`, box.width >= minimum);
  }
  check("no horizontal document overflow", root.scrollWidth <= innerWidth);
  field.value = retainedDraft;
  field.focus();
  check("input retains native focus", document.activeElement === field);
  check(
    "typing does not add a dark input outline",
    getComputedStyle(form).outlineStyle === "none" &&
      getComputedStyle(frame).outlineStyle === "none" &&
      getComputedStyle(field).outlineStyle === "none",
  );
  check(
    "typing does not add a second shadow",
    getComputedStyle(form).boxShadow === formShadow &&
      getComputedStyle(frame).boxShadow === sharedShadow,
  );
  const before = window.fixture.submits;
  submit.click();
  check(
    "native submit semantics preserved",
    window.fixture.submits === before + (submit.disabled ? 0 : 1),
  );
  if (!submit.disabled) {
    submit.focus();
    check(
      "keyboard focus outline remains visible",
      parseFloat(getComputedStyle(submit).outlineWidth) >= 2,
    );
  }

  styleToggle.click();
  check("abort deactivates styles", !root.hasAttribute("data-compose-chat"));
  check(
    "draft and node identity survive disable",
    document.querySelector("form[data-promptbox] textarea") === field &&
      field.value === retainedDraft,
  );
  check("disable removes the lattice", lattice().content === "none");
  check("disable preserves the native label", liveLabel.textContent === nativeText);
  check(
    "disable restores native bundle indentation",
    getComputedStyle(bundle).paddingInlineStart === "0px",
  );
  check(
    "disable restores native image mask",
    getComputedStyle(liveLabel).maskImage.includes("fixture-shine.svg"),
  );
  check("disable releases the visibility marker", !root.hasAttribute("data-compose-chat-motion"));
  check(
    "no unrelated editor styling",
    getComputedStyle(unrelated).backgroundColor === unrelatedStyle,
  );
  check("host font is unchanged", getComputedStyle(field).fontFamily === font);
  check(
    "no chat DOM replacements",
    nativeChildren().length === children.length &&
      nativeChildren().every((el, i) => el === children[i]),
  );
  check("native shadow returns when inactive", getComputedStyle(form).boxShadow !== "none");
  styleToggle.click();
  check("re-enable restores the owned style", root.getAttribute("data-compose-chat") === "active");
  check(
    "re-enable restores lattice geometry",
    liveLabel.getBoundingClientRect().width === beforeDisableLabelWidth,
  );
  if (!reduceMotion) {
    root.setAttribute("data-compose-chat-motion", "paused");
    check("hidden-document state pauses the lattice", lattice().animationPlayState === "paused");
    root.setAttribute("data-compose-chat-motion", "running");
    liveLabel.parentElement.style.animationPlayState = "paused";
    check("native collapsed state pauses the lattice", lattice().animationPlayState === "paused");
    liveLabel.parentElement.style.animationPlayState = "";
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    check(
      "reduced-motion form transition disabled",
      getComputedStyle(form).transitionDuration === "0s",
    );
    check(
      "reduced-motion action transition disabled",
      getComputedStyle(submit).transitionDuration === "0s",
    );
  }
  field.value = draft;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  checkSplitGeometry();
  field.blur();
  submit.blur();
  return {
    mode,
    theme: root.dataset.theme,
    viewport: [innerWidth, innerHeight],
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    contrast: { body: bodyContrast, placeholder: placeholderContrast },
    checks: passed.length,
    passed,
  };
}
