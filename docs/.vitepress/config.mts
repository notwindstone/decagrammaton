import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/decagrammaton/',
  title: "Decagrammaton",
  description: "A Vue 3-like JavaScript framework designed for Secure ECMAScript compartments",
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Get Started', link: '/get-started/introduction' },
    ],

    sidebar: [
      {
        text: 'Get Started',
        items: [
          { text: 'Introduction', link: '/get-started/introduction' },
          { text: 'Differences from Vue 3', link: '/get-started/differences' },
        ],
      },
      {
        text: 'Examples',
        items: [
          { text: 'Simple', link: '/examples/simple' },
          { text: 'Practical', link: '/examples/practical' },
          { text: '7GUIs', link: '/examples/7guis' },
        ],
      },
      {
        text: 'Reactivity',
        items: [
          { text: 'States', link: '/reactivity/states' },
          { text: 'Computed States', link: '/reactivity/computed' },
          { text: 'Effects', link: '/reactivity/effects' },
        ],
      },
      {
        text: 'Properties',
        items: [
          { text: 'Passing Down', link: '/properties/passing-down' },
          { text: 'Injection', link: '/properties/injection' },
        ],
      },
      {
        text: 'Logic',
        items: [
          { text: 'Attributes', link: '/logic/attributes' },
          { text: 'Conditional Rendering', link: '/logic/conditional-rendering' },
          { text: 'Iteration', link: '/logic/iteration' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/notwindstone/decagrammaton' },
    ],
  },
})
