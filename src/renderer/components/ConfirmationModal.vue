<template>
  <div v-if="show" class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal-content">
      <h3 class="modal-title">{{ title }}</h3>
      <p class="modal-message">{{ message }}</p>
      <div v-if="details" class="modal-details">
        <p v-if="details.marketPrice"><strong>Current market price:</strong> {{ details.marketPrice }}</p>
        <p v-if="details.userPrice"><strong>Your price:</strong> {{ details.userPrice }}</p>
        <p v-if="details.deviation"><strong>Deviation:</strong> {{ details.deviation }}%</p>
        <div v-if="details.customContent" v-html="details.customContent"></div>
      </div>
      <div class="modal-actions">
        <button @click="$emit('cancel')" class="modal-cancel">{{ cancelText }}</button>
        <button v-if="showConfirmButton" @click="$emit('confirm')" class="modal-confirm">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ConfirmationModal',
  props: {
    show: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: 'Confirmation'
    },
    message: {
      type: String,
      default: ''
    },
    details: {
      type: Object,
      default: null
    },
    confirmText: {
      type: String,
      default: 'Confirm'
    },
    cancelText: {
      type: String,
      default: 'Cancel'
    },
    showConfirmButton: {
      type: Boolean,
      default: true
    }
  },
  emits: ['confirm', 'cancel']
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  padding: 24px;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-title {
  margin: 0 0 16px 0;
  font-size: 20px;
  font-weight: 600;
  color: #333;
}

.modal-message {
  margin: 0 0 20px 0;
  font-size: 16px;
  color: #555;
  line-height: 1.5;
}

.modal-details {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 4px;
  margin-bottom: 24px;
}

.modal-details p {
  margin: 8px 0;
  font-size: 14px;
  color: #666;
}

.modal-details strong {
  font-weight: 600;
  color: #333;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.modal-actions button {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.modal-cancel {
  background: #e0e0e0;
  color: #333;
}

.modal-cancel:hover {
  background: #d0d0d0;
}

.modal-confirm {
  background: #ff4444;
  color: white;
}

.modal-confirm:hover {
  background: #cc0000;
}
</style>