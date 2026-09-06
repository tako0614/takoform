import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";

import Layout from "./Layout.vue";
import HomePage from "./components/HomePage.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("HomePage", HomePage);
  },
} satisfies Theme;
