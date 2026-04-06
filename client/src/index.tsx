/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Drive from "./pages/Drive";
import ApiKeys from "./pages/ApiKeys";
import "./index.css";

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Drive} />
      <Route path="/folders/:id" component={Drive} />
      <Route path="/api-keys" component={ApiKeys} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
    </Router>
  ),
  document.getElementById("root")!
);
