import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import AsideActions from './AsideActions.vue';
import SidebarSearch from './SidebarSearch.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'sidebar-nav-before': () => h(SidebarSearch),
      'aside-bottom': () => h(AsideActions),
    });
  },
};
