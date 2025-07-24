module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    jest: true  // <-- Add Jest environment here
  },
  extends: [
    'plugin:vue/vue3-recommended',
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 2020
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'vue/no-unused-components': 'warn',
    "vue/html-self-closing": ["warn", {
      "html": {
        "void": "never",
        "normal": "always",
        "component": "never"
      }
    }],
    "no-undef": "error",
  }
};