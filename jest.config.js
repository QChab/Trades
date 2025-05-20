module.exports = {
  moduleFileExtensions: ['js', 'json', 'vue'],
  transform: {
    // Use vue-jest to process .vue files and babel-jest for JavaScript
    '^.+\\.vue$': 'vue-jest',
    '^.+\\.js$': 'babel-jest'
  },
  testMatch: [
    '**/tests/unit/**/*.spec.(js|jsx|ts|tsx)'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  testEnvironment: 'jsdom'
};