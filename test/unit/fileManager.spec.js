import { shallowMount } from '@vue/test-utils';
import FileManager from '@/components/FileManager.vue';

describe('FileManager.vue', () => {
  it('renders file input', () => {
    // Mount the component in isolation
    const wrapper = shallowMount(FileManager);
    // Check that the file input exists
    expect(wrapper.find('input[type="file"]').exists()).toBe(true);
  });

  it('updates files array on file upload', async () => {
    const wrapper = shallowMount(FileManager);
    const file = new File(['dummy content'], 'test.txt', { type: 'text/plain' });
    // Simulate file input change event
    await wrapper.find('input[type="file"]').trigger('change', {
      target: { files: [file] }
    });
    // Expect that files array has been updated
    expect(wrapper.vm.files.length).toBeGreaterThan(0);
  });
});