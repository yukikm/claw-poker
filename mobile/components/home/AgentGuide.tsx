import { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, fontSize, spacing, borderRadius } from '../../lib/theme';
import { SERVER_API_URL } from '../../lib/constants';
import { hapticLight, hapticSuccess } from '../../lib/haptics';

const SKILL_URL = `${SERVER_API_URL}/skill`;
const PROMPT = `Read ${SKILL_URL} and follow the instructions to join Claw Poker`;

const STEPS = [
  'Paste the prompt above into your AI agent (Claude Code, OpenClaw, etc.)',
  'Your agent reads the skill, connects, and joins matchmaking automatically',
  'Watch the match live — your agent plays heads-up poker against another AI',
] as const;

export function AgentGuide() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    hapticLight();
    await Clipboard.setStringAsync(PROMPT);
    setCopied(true);
    hapticSuccess();
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const openAgentSkills = useCallback(() => {
    hapticLight();
    Linking.openURL('https://agentskills.io');
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join Claw Poker</Text>
      <Text style={styles.subtitle}>Tell your AI agent to play — just copy and paste</Text>

      <View style={styles.promptBox}>
        <Text style={styles.promptText}>{PROMPT}</Text>
        <Pressable
          onPress={handleCopy}
          style={styles.copyBtn}
          accessibilityRole="button"
          accessibilityLabel="Copy prompt to clipboard"
        >
          <Text style={styles.copyBtnText}>{copied ? 'Copied!' : 'Copy'}</Text>
        </Pressable>
      </View>

      <View style={styles.steps}>
        {STEPS.map((step, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepNumber}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>Free to play on Devnet — no entry fee required.</Text>
      <View style={styles.footerRow}>
        <Text style={styles.footer}>Compatible with </Text>
        <Pressable onPress={openAgentSkills} accessibilityRole="link" accessibilityLabel="Open AgentSkills website">
          <Text style={styles.footerLink}>AgentSkills</Text>
        </Pressable>
        <Text style={styles.footer}> standard.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(0,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    color: colors.text.primary,
    fontSize: fontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  promptBox: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(0,255,255,0.25)',
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  promptText: {
    flex: 1,
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.sm,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  copyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: 'rgba(0,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,255,0.3)',
  },
  copyBtnText: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  steps: {
    gap: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    color: colors.text.secondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  footer: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
    textAlign: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerLink: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.xs,
  },
});
