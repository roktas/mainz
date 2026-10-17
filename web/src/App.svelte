<!-- Owns PDF lifetimes, Source styles, Output state, and Download. -->
<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { animateRemoval } from "./page-motion.ts";
  import { fade } from "svelte/transition";
  import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
  import { appearance, downloadName, expand, job, maxPages, positionAfterEdit, sizeOf, uid } from "./model.ts";
  import type { Input, Part, Source } from "./model.ts";
  import type { Inspection } from "./Page.svelte";
  import { applicable, applyProfile, available, bufferPages, current, feedback, needsRender } from "./styles.ts";
  import type { Render, Scalar } from "./styles.ts";
  import { loadRenderer, openPDF } from "./pdf.ts";
  import { Processor } from "./processor.ts";
  import Landing from "./Landing.svelte";
  import Settings from "./Settings.svelte";
  import Theme from "./Theme.svelte";
  import Logo from "./Logo.svelte";
  import Icon from "./Icon.svelte";
  import Offline from "./Offline.svelte";
  import Style from "./Style.svelte";
  import Composer from "./Composer.svelte";
  import Help from "./Help.svelte";
  import type { TourStep } from "./Help.svelte";
  import type { Sequence } from "./pages.ts";

  const demo = new URLSearchParams(location.search).get("demo");
  let sources = $state.raw<Source[]>([]);
  let parts = $state.raw<Part[]>([]);
  let sequences = $state.raw<Record<string, Sequence>>({});
  let activeId = $state("");
  let logoReplay = $state(0);
  let magnification = $state<8 | 16 | 32>(16);
  let message = $state("");
  let notice = $state("");
  let noticeDismissed = $state(false);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let messageRevision = $state(0);
  const firstAction = "Select pages · Use + to add to Output.";
  let failure = $state("");
  let loading = $state(false);
  let updating = $state(false);
  let openingStatus = $state("");
  let tour = $state<TourStep>();
  let downloadDialog: HTMLDialogElement;
  let composer = $state<ReturnType<typeof Composer>>(null!);
  let inputMenu = $state<HTMLDetailsElement>(null!);
  let downloadFailure = $state("");
  let downloading = $state(false);
  let downloadStage = $state("");
  let downloadProcessor: Processor | undefined;
  let downloadRevision = 0;
  let downloadTask: PDFDocumentLoadingTask | undefined;
  let downloadUrl: string | undefined;
  let downloadTimer: ReturnType<typeof setTimeout> | undefined;
  let outputChanged = $state(false);
  let modifiedSources = $state.raw<string[]>([]);
  const unsaved = $derived(outputChanged || modifiedSources.length > 0);
  let homeApproved = false;
  let outputPosition = $state(0);
  let outputZoom = $state(100);
  let comparing = $state(false);
  const processors = new Map<string, Processor>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const rendered = new Map<string, Render>();
  const requests = new Map<string, Render>();
  const previewTasks = new Map<string, PDFDocumentLoadingTask>();
  const documents = new Map<PDFDocumentProxy, PDFDocumentLoadingTask>();
  let openingProcessor: Processor | undefined;
  let openingTask: PDFDocumentLoadingTask | undefined;
  let openingSource = $state.raw<Source>();
  let openRevision = 0;
  let disposed = false;
  const active = $derived(sources.find((source) => source.id === activeId) ?? openingSource);
  const output = $derived.by(() => {
    try {
      return { pages: expand(parts, sources), error: "" };
    } catch (reason) {
      return { pages: [], error: reason instanceof Error ? reason.message : "Invalid Output." };
    }
  });
  const outputSources = $derived(
    sources.filter((source) =>
      parts.some((part) => part.pages.some((page) => "source" in page.content && page.content.source === source.id)),
    ),
  );
  const controls = $derived(active ? available(active, parts) : []);
  const styleable = $derived(controls.length > 0);
  const hasProfiles = $derived(
    (active?.input.description.profileSets ?? []).some(
      (set) => set.profiles.length > 1 && set.parameters.some((id) => controls.includes(id)),
    ),
  );
  const outputProcessing = $derived(outputSources.some((source) => source.status === "pending"));
  const inspection: Inspection | undefined = $derived.by(() => {
    const page = output.pages[Math.min(outputPosition, Math.max(0, output.pages.length - 1))];
    if (!page) return;
    const content = page.content;
    const source = "source" in content ? sources.find((item) => item.id === content.source) : undefined;
    const eligible = source && "page" in content ? applicable(source.input.description, [content.page]) : [];
    return {
      ...(source && "page" in content ? appearance(source, content.page) : {}),
      original: source?.input.pdf,
      originalPage: "page" in content ? content.page : undefined,
      comparable:
        !!source &&
        source.status === "ready" &&
        !eligible.some(
          (id) =>
            Object.hasOwn(source.drafts, id) && feedback(source.input.description.parameters[id], source.drafts[id]),
        ) &&
        eligible.some((id) => {
          const entry = source.input.description.parameters[id];
          const parameter = { ...entry.parameter };
          delete parameter.value;
          if (Object.hasOwn(source.overrides, id)) parameter.value = source.overrides[id];
          return current({ ...entry, parameter }).toLowerCase() !== current(entry).toLowerCase();
        }),
      size: sizeOf(page.content, sources),
      padding: page.padding,
    };
  });

  function info(text: string, source?: Source) {
    message = text.charAt(0).toUpperCase() + text.slice(1);
    if (source && source.id !== activeId) message += ` (${source.input.name})`;
    return ++messageRevision;
  }
  function notify(text: string) {
    clearTimeout(noticeTimer);
    noticeDismissed = !text;
    notice = text;
    if (text) noticeTimer = setTimeout(() => (notice = ""), 10000);
  }
  function error(text: string) {
    failure = text;
    info("");
    notify("");
  }
  function update(source: Source) {
    sources = sources.map((item) => (item.id === source.id ? source : item));
  }
  async function releaseUnused() {
    await tick();
    const used = new Set(sources.flatMap((source) => [source.pdf, source.input.pdf]));
    for (const [pdf, loadingTask] of documents) {
      if (!used.has(pdf)) {
        documents.delete(pdf);
        void loadingTask.destroy();
      }
    }
  }
  function composition(next: Part[], text = "Output updated. Input selections and styles are retained.") {
    const previous = parts;
    outputPosition = positionAfterEdit(output.pages, expand(next, sources), outputPosition);
    parts = next;
    outputChanged = true;
    failure = "";
    for (const source of sources)
      if (
        source.status === "pending" ||
        (needsRender(source, next, rendered.get(source.id)!) &&
          !needsRender(source, previous, rendered.get(source.id)!))
      )
        schedule(source.id);
    if (notice === firstAction) notify("");
    info(text);
  }
  function choose(id: string, sequence: Sequence) {
    sequences = { ...sequences, [id]: sequence };
  }
  async function verifyPDF(pdf: PDFDocumentProxy) {
    const { AnnotationMode } = await loadRenderer();
    const page = await pdf.getPage(1),
      size = page.getViewport({ scale: 1 }),
      viewport = page.getViewport({ scale: Math.min(0.2, 2048 / size.width, 2048 / size.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
      await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  }
  async function open(file: Uint8Array | File, name: string) {
    if (loading || updating) return;
    if ((file instanceof File ? file.size : file.length) > 128 * 1024 * 1024) {
      error("Choose a PDF smaller than 128 MiB.");
      return;
    }
    const revision = ++openRevision;
    loading = true;
    failure = "";
    notify("");
    openingStatus = `Opening ${name}…`;
    info(openingStatus);
    const processor = new Processor();
    openingProcessor = processor;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let committed = false;
    let abandoned = false;
    let preview: Source | undefined;
    try {
      const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file;
      if (disposed || revision !== openRevision) return;
      const [result, opened] = await Promise.all([
        processor.run(bytes, revision),
        (async () => {
          loadingTask = await openPDF(bytes);
          if (abandoned || disposed || revision !== openRevision) {
            void loadingTask.destroy();
            return;
          }
          openingTask = loadingTask;
          const pdf = await loadingTask.promise;
          if (pdf.numPages > maxPages) throw new Error(`PDF Studio supports up to ${maxPages} pages.`);
          await verifyPDF(pdf);
          const sizes = [];
          for (let start = 0; start < pdf.numPages; start += 64) {
            if (abandoned || disposed || revision !== openRevision) return;
            const batch = await Promise.all(
              Array.from({ length: Math.min(64, pdf.numPages - start) }, async (_, offset) => {
                const page = await pdf.getPage(start + offset + 1),
                  viewport = page.getViewport({ scale: 1 });
                return { width: (viewport.width * 25.4) / 72, height: (viewport.height * 25.4) / 72 };
              }),
            );
            sizes.push(...batch);
          }
          const labels = (await pdf.getPageLabels()) ?? [];
          if (abandoned || disposed || revision !== openRevision) return;
          const input: Input = {
            id: uid(),
            name,
            bytes,
            pdf,
            sizes,
            labels,
            description: { version: 1, pageCount: pdf.numPages, pages: {}, parameters: {} },
          };
          preview = {
            id: uid(),
            input,
            pdf,
            overrides: {},
            drafts: {},
            status: "ready",
            revision: 0,
          };
          if (!sources.length && !parts.length) openingSource = preview;
          return preview;
        })(),
      ]);
      if (disposed || revision !== openRevision || !opened) return;
      const { pdf } = opened;
      const input: Input = { ...opened.input, description: result.description };
      const overrides = Object.fromEntries(
        Object.entries(result.description.parameters)
          .filter(([, entry]) => Object.hasOwn(entry.parameter, "value"))
          .map(([id, entry]) => [id, entry.parameter.value!]),
      );
      const source: Source = {
        ...opened,
        input,
        overrides,
      };
      documents.set(pdf, loadingTask!);
      rendered.set(source.id, { overrides });
      choose(source.id, {
        text: pdf.numPages === 1 ? "1" : "",
        pages: pdf.numPages === 1 ? [0] : [],
        repeat: "1",
        front: false,
      });
      sources = [...sources, source];
      activeId = source.id;
      openingSource = undefined;
      processors.set(source.id, processor);
      committed = true;
      info(`Opened ${pdf.numPages} ${pdf.numPages === 1 ? "page" : "pages"}.`);
      return source;
    } catch (reason) {
      if (!disposed && revision === openRevision) {
        error(
          `Could not open ${name}. ${reason instanceof Error ? reason.message : "Try another PDF."} Your workspace is retained. Choose a PDF to retry.`,
        );
      }
    } finally {
      abandoned = true;
      if (openingSource?.id === preview?.id) openingSource = undefined;
      if (!committed) {
        processor.dispose();
        void loadingTask?.destroy();
      }
      if (revision === openRevision) {
        loading = false;
        openingProcessor = undefined;
        openingTask = undefined;
      }
    }
  }
  async function files(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        error("Choose a PDF file.");
        continue;
      }
      if (file.size > 128 * 1024 * 1024) {
        error("Choose a PDF smaller than 128 MiB.");
        continue;
      }
      try {
        const source = await open(file, file.name);
        if (!source) break;
      } catch (reason) {
        error(`Could not read ${file.name}. ${reason instanceof Error ? reason.message : "File reading failed."}`);
        break;
      }
    }
  }
  function cancelOpen() {
    openRevision++;
    openingSource = undefined;
    openingProcessor?.dispose();
    openingProcessor = undefined;
    void openingTask?.destroy();
    openingTask = undefined;
    loading = false;
    info("Opening cancelled. Your workspace is retained.");
  }
  function removeSource() {
    if (!active) return;
    const blocking = parts.filter((part) =>
      part.pages.some((page) => "source" in page.content && page.content.source === active.id),
    );
    if (blocking.length) {
      error("Remove this Input's pages from Output before removing it.");
      return;
    }
    for (const sheet of document.querySelectorAll<HTMLElement>(
      ".selection-panel .page-image canvas, .selection-panel .page-scroll canvas",
    ))
      animateRemoval(sheet, () => {});
    const id = active.id;
    const name = active.input.name;
    cancelRender(id);
    processors.get(id)?.dispose();
    processors.delete(id);
    rendered.delete(id);
    const nextSequences = { ...sequences };
    delete nextSequences[id];
    sequences = nextSequences;
    sources = sources.filter((source) => source.id !== id);
    modifiedSources = modifiedSources.filter((source) => source !== id);
    activeId = sources[0]?.id ?? "";
    inputMenu.open = false;
    void tick().then(() => {
      if (active) inputMenu.querySelector("summary")?.focus();
      else document.querySelector<HTMLInputElement>("#workspace input[type=file]")?.focus();
    });
    info(`Removed Input · ${name}. Existing Blanks retain their dimensions.`);
    void releaseUnused();
  }
  function changeStyle(id: string, text: string) {
    if (!active) return;
    const entry = active.input.description.parameters[id];
    const invalid = feedback(entry, text);
    const drafts = { ...active.drafts, [id]: text },
      overrides = invalid
        ? active.overrides
        : { ...active.overrides, [id]: entry.parameter.schema.type === "number" ? Number(text) : text };
    if (!invalid) delete drafts[id];
    update({ ...active, drafts, overrides });
    if (!modifiedSources.includes(active.id)) modifiedSources = [...modifiedSources, active.id];
    const title = entry.parameter.schema.title ?? id;
    if (invalid) error(`Invalid value for ${title}. ${invalid}`);
    else {
      failure = "";
      schedule(active.id, `Updated ${title}.`);
    }
  }
  function resetStyle(id?: string) {
    if (!active) return;
    failure = "";
    const overrides = { ...active.overrides },
      drafts = { ...active.drafts };
    if (id) {
      delete overrides[id];
      delete drafts[id];
    }
    update({ ...active, overrides: id ? overrides : {}, drafts: id ? drafts : {} });
    if (!modifiedSources.includes(active.id)) modifiedSources = [...modifiedSources, active.id];
    schedule(
      active.id,
      id
        ? `Restored ${active.input.description.parameters[id].parameter.schema.title ?? id} to the original style.`
        : "Restored all original styles.",
    );
  }
  function changeProfile(setId: string, profileId: string) {
    if (!active) return;
    const set = active.input.description.profileSets?.find((item) => item.id === setId);
    const profile = set?.profiles.find((item) => item.id === profileId);
    if (!set || !profile) return;
    failure = "";
    update({ ...active, ...applyProfile(set, profile, active) });
    if (!modifiedSources.includes(active.id)) modifiedSources = [...modifiedSources, active.id];
    schedule(active.id, `Applied ${profile.name} profile.`);
  }
  function cancelRender(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    processors.get(id)?.cancel();
    requests.delete(id);
    void previewTasks.get(id)?.destroy();
    previewTasks.delete(id);
  }
  function schedule(id: string, text?: string) {
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    const needed = needsRender(source, parts, rendered.get(id)!);
    const requested = requests.get(id);
    if (needed && requested && !needsRender(source, parts, requested)) {
      if (text) info(text, source);
      return;
    }
    cancelRender(id);
    const revision = source.revision + 1;
    if (!needed) {
      if (source.status !== "ready") update({ ...source, status: "ready", error: undefined, revision });
      if (text) info(text, source);
      return;
    }
    requests.set(id, { overrides: { ...source.overrides }, pages: bufferPages(source, parts) });
    update({ ...source, status: "pending", error: undefined, revision });
    const statusRevision = info("Updating styles…", source);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void renderSource(id, revision, text ?? "Updated styles.", statusRevision);
      }, 200),
    );
  }
  async function renderSource(id: string, revision: number, text: string, statusRevision: number) {
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    let processor = processors.get(id);
    if (!processor) {
      processor = new Processor();
      processors.set(id, processor);
    }
    const overrides: Record<string, Scalar> = { ...source.overrides };
    const pages = bufferPages(source, parts);
    const ids = pages ? applicable(source.input.description, pages) : Object.keys(source.input.description.parameters);
    requests.set(id, { overrides, pages });
    let loadingTask: PDFDocumentLoadingTask | undefined;
    try {
      const result = await processor.run(source.input.bytes, revision, {
        reset: ids,
        apply: Object.fromEntries(Object.entries(overrides).filter(([parameter]) => ids.includes(parameter))),
        buffer: pages ? { input: source.input.id, pages } : undefined,
      });
      if (disposed || sources.find((item) => item.id === id)?.revision !== revision) return;
      loadingTask = await openPDF(new Uint8Array(result.bytes));
      if (disposed || sources.find((item) => item.id === id)?.revision !== revision) {
        void loadingTask.destroy();
        return;
      }
      previewTasks.set(id, loadingTask);
      const pdf = await loadingTask.promise;
      await verifyPDF(pdf);
      const latest = sources.find((item) => item.id === id);
      if (disposed || !latest || latest.revision !== revision) {
        void loadingTask.destroy();
        return;
      }
      documents.set(pdf, loadingTask);
      rendered.set(id, { overrides, pages });
      requests.delete(id);
      update({ ...latest, pdf, pdfPages: pages, status: "ready", error: undefined });
      if (statusRevision === messageRevision) info(text, latest);
      void releaseUnused();
    } catch (reason) {
      void loadingTask?.destroy();
      const latest = sources.find((item) => item.id === id);
      if (!disposed && latest?.revision === revision) {
        requests.delete(id);
        update({
          ...latest,
          status: "error",
          error: reason instanceof Error ? reason.message : "Input style processing failed.",
        });
        if (statusRevision === messageRevision) info("");
      }
    } finally {
      if (previewTasks.get(id) === loadingTask) previewTasks.delete(id);
    }
  }
  function cancelStyle() {
    if (!active) return;
    cancelRender(active.id);
    update({
      ...active,
      status: "error",
      revision: active.revision + 1,
      error: "Style processing cancelled. Your choices are retained.",
    });
    info("Cancelled style processing. Your choices are retained.");
  }
  function releaseDownload() {
    clearTimeout(downloadTimer);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
  }
  function cancelDownload() {
    if (downloading) {
      downloadRevision++;
      downloadProcessor?.dispose();
      downloadProcessor = undefined;
      void downloadTask?.destroy();
      downloadTask = undefined;
      downloading = false;
      info("Download cancelled. Your pages and styles are retained.");
    }
    downloadDialog.close();
  }
  async function download() {
    if (downloading || outputProcessing) return;
    const revision = ++downloadRevision;
    const processor = new Processor();
    downloadFailure = "";
    let loadingTask: PDFDocumentLoadingTask | undefined;
    try {
      const recipe = job(parts, sources);
      for (const source of sources) {
        if (!recipe.sources[source.id]) continue;
        const used = parts.flatMap((part) =>
          part.pages.flatMap((page) =>
            "source" in page.content && page.content.source === source.id ? [page.content.page] : [],
          ),
        );
        for (const [id, text] of Object.entries(source.drafts)) {
          const entry = source.input.description.parameters[id];
          if (
            feedback(entry, text) &&
            entry.pages.some((page) => used.includes(source.input.description.pages[page].index))
          )
            throw new Error(`${source.input.name}: fix ${entry.parameter.schema.title ?? id} before Download.`);
        }
      }
      const inputs = sources.filter((source) => recipe.sources[source.id]).map((source) => source.input);
      if (inputs.length > 32) throw new Error("Download supports up to 32 Inputs.");
      if (inputs.reduce((total, input) => total + input.bytes.length, 0) > 128 * 1024 * 1024)
        throw new Error("Inputs used by Output exceed the 128 MiB total limit.");
      const expected = output.pages.length;
      downloading = true;
      downloadStage = "Preparing PDF…";
      if (!downloadDialog.open) downloadDialog.showModal();
      downloadProcessor = processor;
      const result = await processor.compose(recipe, inputs, revision);
      if (disposed || revision !== downloadRevision) return;
      if (result.description.pageCount !== expected || result.report?.pages.length !== expected)
        throw new Error("The completed PDF does not match the Output page count.");
      downloadStage = "Checking PDF…";
      loadingTask = await openPDF(new Uint8Array(result.bytes));
      if (disposed || revision !== downloadRevision) return;
      downloadTask = loadingTask;
      const pdf = await loadingTask.promise;
      if (pdf.numPages !== expected)
        throw new Error("The completed PDF could not be inspected with the expected page count.");
      await verifyPDF(pdf);
      if (disposed || revision !== downloadRevision) return;
      releaseDownload();
      downloadUrl = URL.createObjectURL(new Blob([result.bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = downloadName(parts, sources);
      link.click();
      downloadTimer = setTimeout(releaseDownload, 30000);
      outputChanged = false;
      modifiedSources = modifiedSources.filter(
        (id) => !recipe.sources[id] || Object.keys(sources.find((source) => source.id === id)!.drafts).length > 0,
      );
      info(`Downloaded ${expected} ${expected === 1 ? "page" : "pages"} · ${link.download}.`);
      downloadDialog.close();
    } catch (reason) {
      if (!disposed && revision === downloadRevision) {
        downloadFailure = reason instanceof Error ? reason.message : "Output processing failed.";
        info("");
        if (!downloadDialog.open) downloadDialog.showModal();
      }
    } finally {
      void loadingTask?.destroy();
      processor.dispose();
      if (revision === downloadRevision) {
        downloading = false;
        downloadProcessor = undefined;
        downloadTask = undefined;
      }
    }
  }
  function home(event: MouseEvent) {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (unsaved && !confirm("Return home? Input style changes and Output choices have not been downloaded.")) {
      event.preventDefault();
      return;
    }
    homeApproved = true;
  }
  function dismiss(event: MouseEvent | KeyboardEvent) {
    if (inputMenu?.open) {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        inputMenu.open = false;
        inputMenu.querySelector("summary")?.focus();
      } else if (event instanceof MouseEvent && !inputMenu.contains(event.target as Node)) inputMenu.open = false;
    }
  }
  onMount(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("reset")) {
      try {
        localStorage.removeItem("mainz:onboarding");
      } catch {
        /* Help shows the welcome when storage is unavailable. */
      }
      url.searchParams.delete("reset");
      history.replaceState(history.state, "", url);
    }
    if (demo === null) return;
    void (async () => {
      let revision = openRevision;
      try {
        const gridDemo = import.meta.env.DEV && demo === "grid";
        if (demo !== "" && demo !== "empty" && !gridDemo) throw new Error(`Unknown demo: ${demo}. Choose a local PDF.`);
        const filename = gridDemo ? "grid.pdf" : "demo.pdf";
        const response = await fetch(`${import.meta.env.BASE_URL}${filename}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (disposed || revision !== openRevision) return;
        if (!response.ok) throw new Error("The demo PDF is unavailable. Choose a local PDF.");
        const source = await open(bytes, filename);
        revision = openRevision;
        if (!source || source.input.pdf.numPages < 7) return;
        if (gridDemo) {
          parts = [
            {
              id: uid(),
              copies: "1",
              front: false,
              pages: Array.from({ length: source.input.pdf.numPages }, (_, page) => ({
                id: uid(),
                content: { source: source.id, page },
              })),
            },
          ];
          info(`Grid workspace · ${source.input.pdf.numPages} pages.`);
          return;
        }
        info("Demo workspace ready.");
        if (demo === "empty") return;
        const pages = [2, 3, 4, 1, 1, 6];
        choose(source.id, { text: "3-5,2,2,7", pages, repeat: "1", front: false });
        parts = [
          {
            id: uid(),
            copies: "1",
            front: false,
            pages: pages.map((page) => ({ id: uid(), content: { source: source.id, page } })),
          },
        ];
        if (import.meta.env.DEV && url.searchParams.has("paint")) {
          const set = source.input.description.profileSets?.find((item) =>
            item.profiles.some((profile) => profile.id === "inkjet"),
          );
          if (set) changeProfile(set.id, "inkjet");
        }
      } catch (reason) {
        if (!disposed && revision === openRevision)
          error(reason instanceof Error ? reason.message : "Demo could not open.");
      }
    })();
  });
  onDestroy(() => {
    disposed = true;
    clearTimeout(noticeTimer);
    openingProcessor?.dispose();
    void openingTask?.destroy();
    downloadProcessor?.dispose();
    void downloadTask?.destroy();
    releaseDownload();
    for (const timer of timers.values()) clearTimeout(timer);
    for (const processor of processors.values()) processor.dispose();
    for (const loadingTask of previewTasks.values()) void loadingTask.destroy();
    for (const loadingTask of documents.values()) void loadingTask.destroy();
  });
</script>

{#snippet sourceStyling(toolbarOnly = false)}
  {#if active}{#key active.id}<Style
        source={active}
        {parts}
        {toolbarOnly}
        {tour}
        style={changeStyle}
        profile={changeProfile}
        reset={resetStyle}
        cancel={cancelStyle}
      />{/key}{/if}
{/snippet}

{#snippet inputTools(heading: string)}
  <details class="input-picker" bind:this={inputMenu}>
    <summary aria-label={`Select Input · ${active?.input.name}`}>
      <h2 id={heading}>
        <Icon name="input" /><span class="input-label">Input</span><span class="count"
          >{sources.length + Number(!!openingSource)}</span
        ><span class="input-current" title={active?.input.name}>{active?.input.name}</span><span class="input-chevron"
          ><Icon name="next" /></span
        >
      </h2>
    </summary>
    <div class="input-list" role="group" aria-label="Inputs">
      {#each sources as source, index (source.id)}<button
          aria-pressed={source.id === activeId}
          data-source={source.id}
          onclick={() => {
            activeId = source.id;
            inputMenu.open = false;
            inputMenu.querySelector("summary")?.focus();
          }}
          ><span class="source-tag">{index + 1}</span><span>{source.input.name}</span>{#if source.id === activeId}<span
              aria-hidden="true">✓</span
            >{/if}</button
        >{/each}
      <button class="danger" onclick={removeSource}><Icon name="trash" />Remove Input</button>
    </div>
  </details>
  <label class="file-picker"
    ><Icon name="add" />Open PDF<input
      type="file"
      accept="application/pdf,.pdf"
      multiple
      disabled={loading || updating}
      onchange={(event) => {
        if (event.currentTarget.files) void files(event.currentTarget.files);
        event.currentTarget.value = "";
      }}
    /></label
  >
{/snippet}

<svelte:document onclick={dismiss} onkeydown={dismiss} />
<svelte:window
  onbeforeunload={(event) => {
    const approved = homeApproved;
    homeApproved = false;
    if (unsaved && !approved) event.preventDefault();
  }}
/>
<a class="skip" href="#workspace">Skip to workspace</a>
<header class="masthead">
  <div class="header-inner">
    {#if !active && !parts.length}<button
        type="button"
        class="brand icon-button"
        aria-label="Replay logo animation"
        title="Replay logo animation"
        onclick={() => logoReplay++}><Logo /></button
      >{:else}<a class="brand" href={import.meta.env.BASE_URL} aria-label="PDF Studio home" onclick={home}><Logo /></a
      >{/if}
    {#if notice}<div
        class="notice"
        role="status"
        aria-atomic="true"
        in:fade={{
          duration: matchMedia("(prefers-reduced-motion: no-preference)").matches ? 180 : 0,
        }}
        out:fade={{
          duration: !noticeDismissed && matchMedia("(prefers-reduced-motion: no-preference)").matches ? 800 : 0,
        }}
      >
        <Icon name="info" />
        {#key notice}<p>{notice}</p>{/key}
        <button class="icon-button" aria-label="Dismiss notification" onclick={() => notify("")}
          ><Icon name="close" /></button
        >
      </div>{/if}
    <div class="header-actions">
      <span class="header-note" title="Processed on your device. No uploads."><Icon name="lock" />On your device</span
      >{#if active || parts.length}<Help
          hasInput={!!active}
          hasOutput={!!output.pages.length}
          {styleable}
          {hasProfiles}
          views={() => composer.views()}
          onboarding={(demo === null || demo === "empty") && !loading}
          change={(step) => {
            tour = step;
          }}
          hint={(show) => {
            if (show) notify(firstAction);
            else if (notice === firstAction) notify("");
          }}
        />{/if}{#if active}<Settings bind:magnification />{/if}<Theme />
    </div>
  </div>
</header>
<main id="workspace">
  {#if failure}<div class="error-banner" role="alert">
      <p>{failure}</p>
      <button class="icon-button" aria-label="Dismiss error" onclick={() => (failure = "")}
        ><Icon name="close" /></button
      >
    </div>{/if}
  {#each sources.filter((source) => source.status === "error") as source (source.id)}
    <div class="error-banner" role="alert">
      <p><strong>{source.input.name}</strong>: {source.error} The last completed preview is shown.</p>
      <button onclick={() => schedule(source.id)}>Retry Input styles</button>
    </div>
  {/each}
  {#if !active}
    <Landing {loading} {updating} status={openingStatus} replay={logoReplay} cancel={cancelOpen} open={files} />
  {/if}
  {#if loading && active}<div class="loading-status" role="status">
      <span>{openingStatus}</span><button onclick={cancelOpen}>Cancel</button>
    </div>{/if}
  {#if active || parts.length}<Composer
      bind:this={composer}
      source={active}
      opening={!!openingSource}
      {sources}
      {parts}
      {output}
      sequence={active ? sequences[active.id] : undefined}
      {choose}
      change={composition}
      {download}
      {error}
      styling={sourceStyling}
      input={inputTools}
      {inspection}
      bind:outputPosition
      bind:outputZoom
      bind:comparing
      activate={(id) => (activeId = id)}
      {outputProcessing}
      {magnification}
      {tour}
    />{/if}
</main>
<footer class="footnote">
  {#if active}<span class="status-input" title={active.input.name}>{active.input.name}</span>{/if}
  <div class="status-messages">
    {#if !loading && message}<p role="status" aria-atomic="true">
        {#key messageRevision}<span class="status-message">{message}</span>{/key}
      </p>{/if}
    <Offline busy={sources.length > 0 || parts.length > 0 || loading} bind:updating {notify} {error} />
  </div>
  <time
    datetime={import.meta.env.BUILD_TIME}
    aria-label={`Build ${import.meta.env.BUILD_ID}`}
    title={`Build ID: Europe/Istanbul · Built ${import.meta.env.BUILD_TIME} (UTC)${import.meta.env.BUILD_REVISION ? ` · Git ${import.meta.env.BUILD_REVISION}` : ""}`}
    >{import.meta.env.BUILD_ID}</time
  >
</footer>

<dialog
  bind:this={downloadDialog}
  class="download-dialog"
  aria-labelledby="download-title"
  oncancel={(event) => {
    event.preventDefault();
    cancelDownload();
  }}
>
  <div class="dialog-heading">
    <h2 id="download-title">Download</h2>
    <button class="icon-button" aria-label="Close Download" onclick={cancelDownload}><Icon name="close" /></button>
  </div>
  {#if downloading}<p role="status">{downloadStage}</p>{:else if downloadFailure}<p class="error" role="alert">
      {downloadFailure}
    </p>{/if}
  <div class="buttons">
    <button onclick={cancelDownload}>Cancel</button>{#if !downloading}<button
        class="primary"
        disabled={outputProcessing}
        onclick={download}>Retry</button
      >{/if}
  </div>
</dialog>
