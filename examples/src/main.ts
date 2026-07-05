import App from "./app.deca";

const container: HTMLElement = document.getElementById("app")!;

App.compile({}).mount(container);
