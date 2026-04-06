// Re-export from the canonical location.
// The AuthNavigator previously imported from here; AppNavigator now imports
// directly from screens/onboarding/OnboardingScreen — this file is kept
// only for backwards compatibility with any other import paths.
export { default } from '../onboarding/OnboardingScreen';
