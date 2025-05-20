// Import the createApp function from Vue to bootstrap the application.
import { createApp } from 'vue';
// Import the main Vue component (App.vue)
import App from './App.vue';

// Create a Vue application instance using the App component.
const app = createApp(App);

// Optional: Add global error handling to catch Vue errors.
app.config.errorHandler = (err, instance, info) => {
  console.error('Vue error:', err, info);
};

// Mount the Vue application to the DOM element with the id "app"
app.mount('#app');