// Bootstraps the application, presents startup recovery, and resets Home in the current document.

if ((window as Window & { mainzSupported?: boolean }).mainzSupported) {
  const target = document.getElementById("app")!
  const loading = document.getElementById("startup")!
  function fail() {
    const heading = document.createElement("h1")
    heading.textContent = "PDF Composer could not load"
    const message = document.createElement("p")
    message.textContent = "Reload the page to try again."
    const reload = document.createElement("button")
    reload.type = "button"
    reload.textContent = "Reload"
    reload.addEventListener("click", () => location.reload())
    loading.setAttribute("role", "alert")
    loading.removeAttribute("aria-label")
    loading.replaceChildren(heading, message, reload)
    target.replaceChildren(loading)
  }
  void Promise.all([import("svelte"), import("./App.svelte"), import("./main.css")])
    .then(([{ mount, unmount, flushSync }, { default: App }]) => {
      async function home() {
        try {
          history.replaceState(history.state, "", import.meta.env.BASE_URL)
          await unmount(application)
          application = flushSync(() => mount(App, { target, props: { home } }))
          target.querySelector<HTMLAnchorElement>(".brand")?.focus({ preventScroll: true })
          window.scrollTo({ top: 0, behavior: "instant" })
        } catch {
          fail()
        }
      }
      let application = flushSync(() => mount(App, { target, props: { home } }))
      loading.remove()
      document.getElementById("unsupported")?.remove()
    })
    .catch(fail)
}
