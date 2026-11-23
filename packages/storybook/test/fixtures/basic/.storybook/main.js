export default {
  stories: ['../src/**/*.stories.jsx'],
  framework: '@storybook/react-vite',
  addons: [
    // The addon's options live here; `circi-storybook upload` reads them.
    { name: '@circi/storybook', options: { name: 'sb-fixture', concurrency: 3 } },
  ],
}
