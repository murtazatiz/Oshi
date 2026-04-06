/**
 * ImportScreen — batch import via pasted URLs or exported browser bookmarks.
 *
 * Tab 1 — Paste URLs:
 *   • Multiline TextInput; detects valid http/https URLs in real time
 *   • "Import X URLs" button with progress bar
 *   • Skips duplicates (POST /saves returns { duplicate: true })
 *
 * Tab 2 — Browser Bookmarks:
 *   • Instructions for exporting bookmarks from Chrome, Firefox, Safari
 *   • expo-document-picker for .html files
 *   • Parses <a href> links; preview list with checkboxes
 *   • Same import flow as Tab 1
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme } from '../theme/ThemeContext';
import { apiClient } from '../services/apiClient';
import { useSavesStore } from '../store/savesStore';
import type { MainStackParamList } from '../navigation/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<MainStackParamList>;

type TabId = 'paste' | 'bookmarks';

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  selected: boolean;
}

type ImportPhase = 'idle' | 'importing' | 'done' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractUrls(text: string): string[] {
  const lines = text.split('\n');
  const unique = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    try {
      const u = new URL(trimmed);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        unique.add(trimmed);
      }
    } catch {
      // not a valid URL
    }
  }
  return [...unique];
}

function parseBookmarkHtml(html: string): BookmarkItem[] {
  const items: BookmarkItem[] = [];
  // Match <a href="...">title</a> — covers all major browser bookmark export formats
  const linkRegex = /<a\s+[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let match: RegExpExecArray | null;
  let id = 0;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1]?.trim() ?? '';
    const title = match[2]?.trim() ?? '';
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        items.push({ id: String(id++), title: title || url, url, selected: true });
      }
    } catch {
      // skip invalid
    }
  }
  return items;
}

const DELAY_BETWEEN_MS = 300; // small delay between saves to avoid rate-limiting

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function importUrls(
  urls: string[],
  addSaveToTop: (save: never) => void,
  onProgress: (done: number, total: number) => void,
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i] ?? '';
    onProgress(i, urls.length);
    try {
      const res = await apiClient.post<{ duplicate?: boolean }>('/saves', { url });
      if (res.data.duplicate) {
        skipped++;
      } else {
        added++;
        // Optimistically add to store so Library tab updates immediately
        addSaveToTop(res.data as never);
      }
    } catch {
      // Treat failures as skipped rather than aborting the batch
      skipped++;
    }
    if (i < urls.length - 1) {
      await sleep(DELAY_BETWEEN_MS);
    }
  }
  onProgress(urls.length, urls.length);
  return { added, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: Progress bar
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ current, total, color }: { current: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(current / total, 1) : 0;
  return (
    <View style={progressStyles.track}>
      <View style={[progressStyles.fill, { width: `${Math.round(pct * 100)}%` as `${number}%`, backgroundColor: color }]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginVertical: 8 },
  fill: { height: 6, borderRadius: 3 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1 — Paste URLs
// ─────────────────────────────────────────────────────────────────────────────

interface PasteTabProps {
  onGoToLibrary: () => void;
}

function PasteUrlsTab({ onGoToLibrary }: PasteTabProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { spacing, borderRadius } = theme;
  const addSaveToTop = useSavesStore((s) => s.addSaveToTop);

  const [text, setText] = useState('');
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState({ added: 0, skipped: 0 });

  const detectedUrls = useMemo(() => extractUrls(text), [text]);

  const handleImport = useCallback(async () => {
    if (detectedUrls.length === 0) return;
    setPhase('importing');
    setProgress({ done: 0, total: detectedUrls.length });
    try {
      const { added, skipped } = await importUrls(
        detectedUrls,
        addSaveToTop,
        (done, total) => setProgress({ done, total }),
      );
      setResult({ added, skipped });
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }, [detectedUrls, addSaveToTop]);

  if (phase === 'done') {
    return (
      <View style={[tabStyles.centeredContent, { padding: spacing.lg }]}>
        <Text style={[tabStyles.successEmoji]}>✅</Text>
        <Text style={[tabStyles.successTitle, { color: colors.textPrimary }]}>
          Import complete
        </Text>
        <Text style={[tabStyles.successBody, { color: colors.textSecondary }]}>
          {result.added} save{result.added !== 1 ? 's' : ''} added
          {result.skipped > 0 ? `, ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''} skipped` : ''}
        </Text>
        <TouchableOpacity
          style={[tabStyles.primaryBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
          onPress={onGoToLibrary}
        >
          <Text style={tabStyles.primaryBtnText}>Go to Library</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[tabStyles.secondaryBtn]}
          onPress={() => {
            setText('');
            setPhase('idle');
            setProgress({ done: 0, total: 0 });
          }}
        >
          <Text style={[tabStyles.secondaryBtnText, { color: colors.accent }]}>Import more</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[tabStyles.centeredContent, { padding: spacing.lg }]}>
        <Text style={tabStyles.successEmoji}>❌</Text>
        <Text style={[tabStyles.successTitle, { color: colors.textPrimary }]}>Something went wrong</Text>
        <Text style={[tabStyles.successBody, { color: colors.textSecondary }]}>
          Check your connection and try again.
        </Text>
        <TouchableOpacity
          style={[tabStyles.primaryBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
          onPress={() => setPhase('idle')}
        >
          <Text style={tabStyles.primaryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[tabStyles.label, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
          Paste one URL per line
        </Text>
        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          placeholder={'https://youtube.com/watch?v=...\nhttps://example.com/article\nhttps://...'}
          placeholderTextColor={colors.textMuted}
          style={[
            tabStyles.textarea,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: borderRadius.sm,
              color: colors.textPrimary,
            },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          editable={phase === 'idle'}
        />

        <Text style={[tabStyles.detectedCount, { color: detectedUrls.length > 0 ? colors.success : colors.textMuted }]}>
          {detectedUrls.length > 0
            ? `${detectedUrls.length} URL${detectedUrls.length !== 1 ? 's' : ''} detected`
            : 'No valid URLs detected yet'}
        </Text>

        {phase === 'importing' && (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={[tabStyles.progressLabel, { color: colors.textSecondary }]}>
              Saving {progress.done} of {progress.total}…
            </Text>
            <ProgressBar current={progress.done} total={progress.total} color={colors.accent} />
          </View>
        )}

        <TouchableOpacity
          style={[
            tabStyles.primaryBtn,
            {
              backgroundColor: detectedUrls.length > 0 && phase === 'idle' ? colors.accent : colors.border,
              borderRadius: borderRadius.sm,
            },
          ]}
          onPress={() => void handleImport()}
          disabled={detectedUrls.length === 0 || phase === 'importing'}
        >
          {phase === 'importing' ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={tabStyles.primaryBtnText}>
              Import {detectedUrls.length > 0 ? `${detectedUrls.length} ` : ''}URL{detectedUrls.length !== 1 ? 's' : ''}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2 — Browser Bookmarks
// ─────────────────────────────────────────────────────────────────────────────

const BROWSER_INSTRUCTIONS = [
  {
    browser: '🌐 Chrome / Edge',
    steps: [
      'Open Chrome → three-dot menu → Bookmarks → Bookmark manager',
      'Click the three-dot menu at the top right of Bookmark manager',
      'Select "Export bookmarks" → saves as an HTML file',
    ],
  },
  {
    browser: '🦊 Firefox',
    steps: [
      'Open Library (☰ → Bookmarks → Manage bookmarks)',
      'Click "Import and Backup" → "Export Bookmarks to HTML…"',
      'Save the file to your device',
    ],
  },
  {
    browser: '🍎 Safari',
    steps: [
      'Open Safari → File → Export Bookmarks…',
      'Save the exported HTML file',
      'Transfer it to this device via AirDrop, Files, or email',
    ],
  },
];

interface BookmarksTabProps {
  onGoToLibrary: () => void;
}

function BrowserBookmarksTab({ onGoToLibrary }: BookmarksTabProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { spacing, borderRadius } = theme;
  const addSaveToTop = useSavesStore((s) => s.addSaveToTop);

  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [parseError, setParseError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState({ added: 0, skipped: 0 });
  const [showInstructions, setShowInstructions] = useState(true);

  const selectedBookmarks = useMemo(() => bookmarks.filter((b) => b.selected), [bookmarks]);

  const toggleBookmark = useCallback((id: string) => {
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b)),
    );
  }, []);

  const toggleAll = useCallback(() => {
    const allSelected = bookmarks.every((b) => b.selected);
    setBookmarks((prev) => prev.map((b) => ({ ...b, selected: !allSelected })));
  }, [bookmarks]);

  const pickFile = useCallback(async () => {
    setParseError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'text/html',
        copyToCacheDir: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;

      const response = await fetch(asset.uri);
      const html = await response.text();
      const parsed = parseBookmarkHtml(html);

      if (parsed.length === 0) {
        setParseError('No valid URLs found in this file. Make sure it is a bookmark export HTML file.');
        return;
      }

      setBookmarks(parsed);
      setShowInstructions(false);
    } catch (err) {
      setParseError('Could not read the file. Please try again.');
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (selectedBookmarks.length === 0) return;
    setPhase('importing');
    const urls = selectedBookmarks.map((b) => b.url);
    setProgress({ done: 0, total: urls.length });
    try {
      const { added, skipped } = await importUrls(
        urls,
        addSaveToTop,
        (done, total) => setProgress({ done, total }),
      );
      setResult({ added, skipped });
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }, [selectedBookmarks, addSaveToTop]);

  if (phase === 'done') {
    return (
      <View style={[tabStyles.centeredContent, { padding: spacing.lg }]}>
        <Text style={tabStyles.successEmoji}>✅</Text>
        <Text style={[tabStyles.successTitle, { color: colors.textPrimary }]}>Import complete</Text>
        <Text style={[tabStyles.successBody, { color: colors.textSecondary }]}>
          {result.added} save{result.added !== 1 ? 's' : ''} added
          {result.skipped > 0 ? `, ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''} skipped` : ''}
        </Text>
        <TouchableOpacity
          style={[tabStyles.primaryBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
          onPress={onGoToLibrary}
        >
          <Text style={tabStyles.primaryBtnText}>Go to Library</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={tabStyles.secondaryBtn}
          onPress={() => {
            setBookmarks([]);
            setPhase('idle');
            setShowInstructions(true);
          }}
        >
          <Text style={[tabStyles.secondaryBtnText, { color: colors.accent }]}>Import another file</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[tabStyles.centeredContent, { padding: spacing.lg }]}>
        <Text style={tabStyles.successEmoji}>❌</Text>
        <Text style={[tabStyles.successTitle, { color: colors.textPrimary }]}>Something went wrong</Text>
        <Text style={[tabStyles.successBody, { color: colors.textSecondary }]}>
          Check your connection and try again.
        </Text>
        <TouchableOpacity
          style={[tabStyles.primaryBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
          onPress={() => setPhase('idle')}
        >
          <Text style={tabStyles.primaryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Preview list (after file is parsed) ───────────────────────────────────
  if (bookmarks.length > 0) {
    const allSelected = bookmarks.every((b) => b.selected);

    return (
      <View style={{ flex: 1 }}>
        <View style={[bookmarkStyles.previewHeader, { padding: spacing.md, borderBottomColor: colors.border }]}>
          <Text style={[bookmarkStyles.previewTitle, { color: colors.textPrimary }]}>
            Found {bookmarks.length} bookmark{bookmarks.length !== 1 ? 's' : ''}
          </Text>
          <TouchableOpacity onPress={toggleAll}>
            <Text style={[bookmarkStyles.toggleAll, { color: colors.accent }]}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={bookmarks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => toggleBookmark(item.id)}
              style={[bookmarkStyles.bookmarkRow, { borderBottomColor: colors.border, paddingHorizontal: spacing.md }]}
            >
              <View style={[
                bookmarkStyles.checkbox,
                {
                  borderColor: item.selected ? colors.accent : colors.border,
                  backgroundColor: item.selected ? colors.accent : 'transparent',
                  borderRadius: 4,
                },
              ]}>
                {item.selected && <Text style={bookmarkStyles.checkmark}>✓</Text>}
              </View>
              <View style={bookmarkStyles.bookmarkInfo}>
                <Text style={[bookmarkStyles.bookmarkTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[bookmarkStyles.bookmarkUrl, { color: colors.textMuted }]} numberOfLines={1}>
                  {item.url}
                </Text>
              </View>
            </Pressable>
          )}
          style={{ flex: 1 }}
        />

        {phase === 'importing' && (
          <View style={{ paddingHorizontal: spacing.md }}>
            <Text style={[tabStyles.progressLabel, { color: colors.textSecondary }]}>
              Saving {progress.done} of {progress.total}…
            </Text>
            <ProgressBar current={progress.done} total={progress.total} color={colors.accent} />
          </View>
        )}

        <View style={[bookmarkStyles.bottomBar, { padding: spacing.md, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              tabStyles.primaryBtn,
              {
                backgroundColor: selectedBookmarks.length > 0 && phase === 'idle' ? colors.accent : colors.border,
                borderRadius: borderRadius.sm,
              },
            ]}
            onPress={() => void handleImport()}
            disabled={selectedBookmarks.length === 0 || phase === 'importing'}
          >
            {phase === 'importing' ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={tabStyles.primaryBtnText}>
                Import selected ({selectedBookmarks.length})
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={tabStyles.secondaryBtn}
            onPress={() => { setBookmarks([]); setShowInstructions(true); }}
          >
            <Text style={[tabStyles.secondaryBtnText, { color: colors.textMuted }]}>Choose different file</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Instructions + file picker ────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md }}>
      {showInstructions && BROWSER_INSTRUCTIONS.map((section) => (
        <View
          key={section.browser}
          style={[
            bookmarkStyles.instructionCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: borderRadius.sm,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Text style={[bookmarkStyles.browserName, { color: colors.textPrimary }]}>
            {section.browser}
          </Text>
          {section.steps.map((step, i) => (
            <View key={i} style={bookmarkStyles.stepRow}>
              <Text style={[bookmarkStyles.stepNumber, { color: colors.accent }]}>{i + 1}.</Text>
              <Text style={[bookmarkStyles.stepText, { color: colors.textSecondary }]}>{step}</Text>
            </View>
          ))}
        </View>
      ))}

      {parseError ? (
        <Text style={[bookmarkStyles.parseError, { color: colors.error, marginBottom: spacing.md }]}>
          {parseError}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[
          tabStyles.primaryBtn,
          { backgroundColor: colors.accent, borderRadius: borderRadius.sm },
        ]}
        onPress={() => void pickFile()}
      >
        <Text style={tabStyles.primaryBtnText}>📂  Choose Bookmark File (.html)</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ImportScreen
// ─────────────────────────────────────────────────────────────────────────────

export default function ImportScreen(): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { spacing } = theme;
  const navigation = useNavigation<NavProp>();

  const [activeTab, setActiveTab] = useState<TabId>('paste');

  const goToLibrary = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'LibraryTab', params: { screen: 'LibraryHome' } });
  }, [navigation]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* ── Screen title ─────────────────────────────────────────────── */}
      <View style={[styles.headerBar, { paddingHorizontal: spacing.md, borderBottomColor: colors.border }]}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>Import</Text>
      </View>

      {/* ── Tab switcher ─────────────────────────────────────────────── */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {(['paste', 'bookmarks'] as TabId[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tabBtn,
              activeTab === tab && { borderBottomColor: colors.accent, borderBottomWidth: 2 },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[
              styles.tabLabel,
              { color: activeTab === tab ? colors.accent : colors.textMuted },
            ]}>
              {tab === 'paste' ? 'Paste URLs' : 'Browser Bookmarks'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Tab content ──────────────────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        {activeTab === 'paste'
          ? <PasteUrlsTab onGoToLibrary={goToLibrary} />
          : <BrowserBookmarksTab onGoToLibrary={goToLibrary} />
        }
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerBar: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});

const tabStyles = StyleSheet.create({
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  textarea: {
    minHeight: 180,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  detectedCount: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  progressLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  primaryBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  successEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  successBody: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
});

const bookmarkStyles = StyleSheet.create({
  instructionCard: {
    padding: 16,
    borderWidth: 1,
  },
  browserName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  stepRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    width: 20,
    marginTop: 1,
  },
  stepText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 19,
  },
  parseError: {
    fontSize: 14,
    lineHeight: 20,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  toggleAll: {
    fontSize: 14,
    fontWeight: '600',
  },
  bookmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  checkmark: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  bookmarkInfo: {
    flex: 1,
  },
  bookmarkTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  bookmarkUrl: {
    fontSize: 12,
  },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
