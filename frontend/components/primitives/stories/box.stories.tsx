import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '../box';

const meta: Meta<typeof Box> = {
  title: 'Primitives/Box',
  component: Box,
  argTypes: {
    as: {
      control: 'select',
      options: ['div', 'span', 'section', 'article', 'aside', 'main', 'header', 'footer'],
    },
    className: {
      control: 'text',
    },
  },
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Box>;

export const Default: Story = {
  args: {
    children: 'Box content',
    className: 'p-4 bg-gray-100 rounded',
  },
};

export const WithAsProp: Story = {
  args: {
    as: 'section',
    children: 'Section content',
    className: 'p-4 bg-blue-100 rounded',
  },
};

export const StyledBox: Story = {
  args: {
    children: 'Styled box with custom styles',
    className: 'p-8 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg shadow-lg',
  },
};

export const NestedBoxes: Story = {
  render: () => (
    <Box className="p-6 bg-gray-200 rounded-lg">
      <Box className="p-4 bg-blue-200 rounded mb-2">
        <Box className="p-2 bg-green-200 rounded">
          Nested box content
        </Box>
      </Box>
    </Box>
  ),
};
