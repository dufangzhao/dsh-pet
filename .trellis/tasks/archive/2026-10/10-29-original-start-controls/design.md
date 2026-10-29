# Design

The defect is the presentation seam: StartSlots carries the old fully rendered controls, so five layouts inherit the rejected replica vocabulary. Extract/reuse behavior as state+actions, then render those through our own components. Layout slots may be reused only when their new controls are original, not when they wrap old ModelForm/PetPreview/ThemeEditor JSX.

Three disjoint DeepSeek scopes: design-system/shell owner; model/start integrator; preview/theme owner. Publish a small native-prop-based kit contract promptly; no generic component engine or new CSS framework. Original tokens and component states are first-class evidence. Use the existing single theme owner; original builtin palettes migrate only builtin IDs, custom schemes persist. Model/draft/recording lifetime stays above layout switches. Normal and lab consume the same new controls.

Parent owns task/skill/contracts/native integration and QA. Existing review flag/profile/URL remain unchanged. Archive previous screenshots as rejection evidence; new images must show a visibly distinct component language, not only grid changes. A later independent reviewer sees actual captures and product source.
