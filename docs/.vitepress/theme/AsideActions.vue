<script setup lang="ts">
import { computed } from 'vue';
import { useData } from 'vitepress';

const repoUrl = 'https://github.com/iamabhishekmathur/hearth';
const { frontmatter, page, theme } = useData();

const editLink = computed(() => {
  if (!theme.value.editLink || frontmatter.value.editLink === false) {
    return undefined;
  }

  const { pattern = '' } = theme.value.editLink;
  const filePath = page.value.filePath;
  const url = typeof pattern === 'function'
    ? pattern(page.value)
    : pattern.replace(/:path/g, filePath);

  return url ? { text: 'Edit this page', url } : undefined;
});

const sourceLink = computed(() => `${repoUrl}/blob/main/docs/${page.value.filePath}`);
const issueLink = computed(() => {
  const title = encodeURIComponent(`Docs feedback: ${page.value.title}`);
  return `${repoUrl}/issues/new?title=${title}`;
});
</script>

<template>
  <div class="HearthAsideActions" aria-label="Page actions">
    <a v-if="editLink" :href="editLink.url" target="_blank" rel="noreferrer">
      <span class="vpi-square-pen" aria-hidden="true" />
      <span>{{ editLink.text }}</span>
    </a>
    <a :href="issueLink" target="_blank" rel="noreferrer">
      <span class="hearth-aside-icon hearth-aside-icon-issue" aria-hidden="true" />
      <span>Open an issue</span>
    </a>
    <a :href="sourceLink" target="_blank" rel="noreferrer">
      <span class="hearth-aside-icon hearth-aside-icon-github" aria-hidden="true" />
      <span>View on GitHub</span>
    </a>
  </div>
</template>
