<template>
  <div class="file-manager">
    <!-- Title section: toggles visibility of file input -->
    <p class="title" v-if="title" @click="isInputShown = !isInputShown">
      {{ title }}
      <!-- Chevron image rotates based on input visibility -->
      <img
        :src="chevronDownImage"
        class="chevron-down"
        :class="{ rotated: isInputShown }"
      />
    </p>
    <div v-if="isInputShown">
      <!-- Error message display -->
      <p class="error-message" v-if="error.length > 0"> {{ error }} </p>
      <!-- File input element with a ref to reset its value after file selection -->
      <div v-if="shouldHideNoFile">
        <label :for="'fileInput' + id" class="custom-file-label">
          Choose a file
        </label>
        <span class="margin-left"> {{ lastFileName }}</span>
        <!-- Hidden native file input; clicking the label will open this dialog -->
        <input
          ref="fileInput"
          :id="'fileInput' + id"
          type="file"
          @change="handleFileUpload"
          style="display: none;"
          :accept="extensions.length === 0 ? '*' : '.' + extensions.replace(/ /g, ', .')"
        >
      </div>
      <div v-else>
        <input
          ref="fileInput"
          :id="'fileInput' + id"
          type="file"
          @change="handleFileUpload"
          :accept="extensions.length === 0 ? '*' : '.' + extensions.replace(/ /g, ', .')"
        >
      </div>
      <!-- <input
        type="file"
        @change="handleFileUpload"
        :accept="extensions.length === 0 ? '*' : '.' + extensions.replace(/ /g, ', .')"
      /> -->
      <!-- Optional preview of file content -->
      <textarea
        v-if="fileContent && !noPreview"
        v-model="fileContent"
        readonly
        rows="4"
        cols="20"
      ></textarea>
      <!-- Additional preview content -->
      <p v-if="otherPreview" class="small-scrollable">{{ otherPreview }}</p>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue';
// Import XLSX for handling Excel files
import * as XLSX from 'xlsx';
// Import the chevron down image
import chevronDownImage from '@/../assets/chevron-down.svg';

export default {
  name: 'FileManager',
  props: {
    fileType: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      default: '',
    },
    noPreview: {
      type: Boolean,
      default: false,
    },
    extensions: {
      type: String,
      default: '',
    },
    otherPreview: {
      type: String,
      default: '',
    },
    error: {
      type: String,
      default: '',
    },
    id: {
      type: Number,
      default: 0,
    },
    shouldHideNoFile: {
      type: Boolean,
      default: true,
    }
  },
  emits: ['file:new'],
  setup(props, { emit }) {
    const lastFileName = ref(''); // Store the name of the last uploaded file
    // Reactive variable to store the file's content after upload.
    const fileContent = ref('');
    // Controls whether the file input and preview are visible.
    const isInputShown = ref(true);
    // Reference to the file input element to allow resetting its value.
    const fileInput = ref(null);

    // Handle the file upload process.
    function handleFileUpload(event) {
      // Get the first file selected by the user.
      const file = event.target.files[0];
      if (file) {
        // Extract the file extension (lowercase).
        const ext = file.name.split('.').pop().toLowerCase();
        // Create a new FileReader instance.
        const reader = new FileReader();

        // If the file is an Excel file, read it as an ArrayBuffer.
        if (ext === 'xlsx' || ext === 'xls') {
          reader.readAsArrayBuffer(file);
        } else {
          // Otherwise, read the file as plain text.
          reader.readAsText(file);
        }

        lastFileName.value = file.name; // Save the file name for later display

        // Once the file is loaded, process its content.
        reader.onload = (e) => {
          // Save the file content to the reactive variable.
          fileContent.value = e.target.result;
          // Variable to hold Excel workbook data if applicable.
          let workbook;
          if (ext === 'xlsx' || ext === 'xls') {
            // For Excel files, parse the ArrayBuffer using XLSX.
            const arrayBuffer = e.target.result;
            workbook = XLSX.read(arrayBuffer, { type: 'array' });
          }

          // Emit the 'file:new' event with the processed content and extension.
          emit('file:new', {
            fileContent: workbook ? workbook : fileContent.value,
            ext: ext,
          });

          // Reset the file input value so that the same file can be selected again.
          // This is necessary because file input does not trigger change if the same file is re-selected.
          if (props.shouldHideNoFile) {
            if (fileInput.value) {
              fileInput.value.value = '';
            }
          }
        };
      }
    }

    onMounted(() => console.log(props))

    // Return reactive variables and methods for use in the template.
    return {
      fileContent,
      handleFileUpload,
      chevronDownImage,
      isInputShown,
      fileInput,
      lastFileName,
    };
  },
};
</script>

<style scoped>
/* Title styling with centered text and pointer cursor */
p.title {
  text-align: center;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

/* Spacing for the file manager container */
.file-manager {
  margin-bottom: 20px;
}

/* Styling for the preview textarea */
textarea {
  width: 100%;
  resize: vertical;
  margin-top: 10px;
}

/* Styling for allowed file extensions text (if used) */
.extensions {
  color: #999;
  font-size: 0.8em;
}

.custom-file-label {
  display: inline-block;
  padding: 4px 6px;
  color: #000;
  cursor: pointer;
  border-radius: 4px;
  border: 1px solid grey;
  /* Additional styling as desired */
}

.margin-left {
  margin-left: 10px;
}
</style>