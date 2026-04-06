/**
 * OnboardingScreen — orchestrates all 9 onboarding steps.
 *
 * Step index map (0-based internally):
 *   0  Welcome           (skip → 1)
 *   1  Value 1 – Save Anything    (skip → 2)
 *   2  Value 2 – AI Organises     (skip → 3)
 *   3  Value 3 – Never Forget     (skip → 4)
 *   4  Account Creation  (NO skip)
 *   5  Reminder Setup    (skip → 6, stores default 7 PM daily)
 *   6  Notification Perm (skip → 7)
 *   7  Share Sheet Setup (skip → 8)
 *   8  First Save Prompt (skip/done → marks onboarding complete)
 *
 * Transitions: RN built-in Animated API (slide + fade).
 * Per PRD §3.5.1 and user requirement: "skip = next step, not Library."
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';

import { useOnboardingActions } from '../../store/onboardingStore';
import analytics from '../../services/analytics';

import StepWelcome from './StepWelcome';
import StepValue, { type ValueStepContent } from './StepValue';
import StepAccountCreation from './StepAccountCreation';
import StepReminder from './StepReminder';
import StepNotificationPerm from './StepNotificationPerm';
import StepShareSheet from './StepShareSheet';
import StepFirstSave from './StepFirstSave';

// ─────────────────────────────────────────────
// Value screen data
// ─────────────────────────────────────────────
const VALUE_SCREENS: ValueStepContent[] = [
  {
    icon: '🔖',
    headline: 'Save Anything',
    body: 'Articles, videos, podcasts, social posts — if you can share it, Oshi can save it. One tap from any app.',
  },
  {
    icon: '🤖',
    headline: 'AI Organises',
    body: 'GPT-4 reads every save and drops it into the right category automatically. No manual sorting, ever.',
  },
  {
    icon: '💡',
    headline: 'Never Forget',
    body: 'A daily nudge reminds you to revisit your saves. Your best ideas, always within reach.',
  },
];

const TOTAL_STEPS = 9;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SLIDE_OFFSET = SCREEN_WIDTH * 0.18;

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
const STEP_NAMES = [
  'welcome', 'value_save_anything', 'value_ai_organises', 'value_never_forget',
  'account_creation', 'reminder_setup', 'notification_permission',
  'share_sheet_setup', 'first_save_prompt',
] as const;

export default function OnboardingScreen(): React.JSX.Element {
  const [displayStep, setDisplayStep] = useState(0);
  const isAnimating = useRef(false);
  const { markComplete } = useOnboardingActions();

  useEffect(() => {
    analytics.onboardingStarted();
  }, []);

  // ── Animated values ───────────────────────────────────────────────────────
  const offset = useRef(new Animated.Value(0)).current;    // translateX
  const fadeAnim = useRef(new Animated.Value(1)).current;  // opacity

  // ── Step transition ───────────────────────────────────────────────────────
  const goToStep = useCallback(
    (target: number) => {
      if (isAnimating.current) return;
      isAnimating.current = true;

      // Phase 1: slide left + fade out simultaneously
      Animated.parallel([
        Animated.timing(offset, {
          toValue: -SLIDE_OFFSET,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Invisible — switch step and jump to right side
        setDisplayStep(target);
        offset.setValue(SLIDE_OFFSET);

        // Phase 2: slide in from right + fade in simultaneously
        Animated.parallel([
          Animated.timing(offset, {
            toValue: 0,
            duration: 220,
            useNativeDriver: true,
          }),
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
        ]).start(() => {
          isAnimating.current = false;
        });
      });
    },
    [offset, fadeAnim],
  );

  function next(): void {
    analytics.onboardingStepCompleted(displayStep, STEP_NAMES[displayStep] ?? 'unknown');
    if (displayStep >= TOTAL_STEPS - 1) {
      void finishOnboarding();
    } else {
      goToStep(displayStep + 1);
    }
  }

  function skip(): void {
    analytics.onboardingSkipped(displayStep);
    next();
  }

  async function finishOnboarding(): Promise<void> {
    analytics.onboardingCompleted();
    await markComplete();
    // AppNavigator re-renders and switches to Main stack automatically
  }

  async function handleSignIn(): Promise<void> {
    analytics.onboardingCompleted();
    await markComplete();
  }

  // ── Render current step ───────────────────────────────────────────────────
  function renderStep(): React.JSX.Element {
    switch (displayStep) {
      case 0:
        return <StepWelcome onNext={next} onSkip={skip} />;

      case 1:
        return (
          <StepValue
            content={VALUE_SCREENS[0]!}
            stepIndex={1}
            totalSteps={4}
            onNext={next}
            onSkip={skip}
          />
        );

      case 2:
        return (
          <StepValue
            content={VALUE_SCREENS[1]!}
            stepIndex={2}
            totalSteps={4}
            onNext={next}
            onSkip={skip}
          />
        );

      case 3:
        return (
          <StepValue
            content={VALUE_SCREENS[2]!}
            stepIndex={3}
            totalSteps={4}
            onNext={next}
            onSkip={skip}
          />
        );

      case 4:
        return (
          <StepAccountCreation
            onSignUp={next}
            onSignIn={() => void handleSignIn()}
          />
        );

      case 5:
        return <StepReminder onNext={next} onSkip={next} />;

      case 6:
        return <StepNotificationPerm onNext={next} onSkip={next} />;

      case 7:
        return <StepShareSheet onNext={next} onSkip={next} />;

      case 8:
        return <StepFirstSave onDone={() => void finishOnboarding()} />;

      default:
        return <StepWelcome onNext={next} onSkip={next} />;
    }
  }

  return (
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.stepContainer,
          {
            transform: [{ translateX: offset }],
            opacity: fadeAnim,
          },
        ]}
      >
        {renderStep()}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stepContainer: { flex: 1 },
});
