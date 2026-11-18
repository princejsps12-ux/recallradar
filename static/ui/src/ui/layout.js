// Layout from Atlaskit's compiled primitives (their CSS ships as a normal stylesheet, so Jira's content security policy lets it
// through: the legacy emotion-based `@atlaskit/primitives` entry would write <style> tags at run time and render unstyled).
// Spacing is given with the design-token names ("space.200"), never pixels.
export { Box, Stack, Inline } from '@atlaskit/primitives/compiled';
