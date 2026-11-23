import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

// Lives in its own module (not AppNavigator.tsx) so non-React code such as
// services/paywall.ts can navigate without importing the screen tree, which
// would create an import cycle through the stores and apiClient.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
