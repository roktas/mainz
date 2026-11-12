// Gates application loading on required browser features and mounts the workspace.

if ((window as Window & { mainzSupported?: boolean }).mainzSupported) {
  const target = document.getElementById("app")!
  target.replaceChildren()
  void Promise.all([import("svelte"), import("./App.svelte"), import("./main.css")]).then(
    ([{ mount }, { default: App }]) => {
      mount(App, { target })
    },
  )
}
