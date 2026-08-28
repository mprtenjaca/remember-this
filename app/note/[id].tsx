// Note detail + edit (M3-lite). Every change goes through applyMutations() → user_edited = 1, audit, undo.
// Time edits use the NATIVE picker. Never a custom one.

import React, { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { Screen } from "@/ui/components/Screen";
import { Body, Display, Label, Mono } from "@/ui/components/Txt";
import { Button } from "@/ui/components/Button";
import { TriggerRow } from "@/ui/components/TriggerRow";
import { Hairline } from "@/ui/components/Hairline";
import { Glass } from "@/ui/components/Glass";
import { DatePickerSheet } from "@/ui/components/DatePickerSheet";
import { ReadingCard } from "@/ui/components/ReadingCard";
import { ClarifyCard } from "@/ui/components/ClarifyCard";
import { useLiveQuery } from "@/ui/hooks/useLiveQuery";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { FONT, R, S, T } from "@/ui/theme/tokens";
import { db } from "@/db";
import { notesRepo } from "@/db/repositories/notes";
import { triggersRepo } from "@/db/repositories/triggers";
import { anchorsRepo } from "@/db/repositories/anchors";
import { editsRepo } from "@/db/repositories/edits";
import { applyMutations, undoLast } from "@/db/applyMutations";
import { clock } from "@/domain/clock";
import { fmtDate, fmtDateTime, fmtMonthDay, fmtRelative, toLocalIso } from "@/domain/dates";
import { describeMutation } from "@/domain/mutations";
import { DEFAULT_ANCHOR_TIME, formatMonthDay, nextOccurrence } from "@/domain/triggers/resolve";
import type { Anchor, Mutation, Trigger } from "@/domain/types";
import { retryEnrich } from "@/services/ai/queue";
import { shouldOfferReread } from "@/domain/enrich/rereadPrompt";
import { setNoteText, setNoteDone, setReminderActive, setReminderDone } from "@/services/noteActions";
import { reminderProgress } from "@/domain/noteStatus";
import { playDing } from "@/services/sound";
import { uiLang } from "@/ui/theme/locale";

async function load(id: string) {
  const d = db();
  const note = await notesRepo.byId(d, id);
  if (!note) return null;
  const triggers = await triggersRepo.byNote(d, id);
  const anchors = await anchorsRepo.byIds(d, Array.from(new Set(triggers.map((t) => t.anchorId).filter((x): x is string => !!x))));
  const edits = await editsRepo.byNote(d, id, 1);
  return { note, triggers, anchors: new Map(anchors.map((a) => [a.id, a])), lastEdit: edits[0] ?? null, now: clock.now() };
}

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const router = useRouter();
  const { data } = useLiveQuery(() => load(id!), [id]);
  const [editing, setEditing] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState<{ kind: "time"; triggerId: string | null; value: Date } | { kind: "anchor"; anchor: Anchor; value: Date } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);

  const mutate = useCallback(
    async (muts: Mutation[], toast?: string) => {
      if (!id) return;
      await applyMutations(id, muts, "manual");
      setUndo(toast ?? describeMutation(muts[0]!));
      setTimeout(() => setUndo(null), 5000);
    },
    [id],
  );

  if (!data) return <Screen />;
  const { note, triggers, anchors, now } = data;
  const lang = uiLang(); // UI copy follows the DEVICE language, never the note
  const progress = reminderProgress(triggers);
  // The semantic trigger is not a reminder — it gets its own row below, with no actions.
  const reminders = triggers.filter((tr) => tr.type !== "semantic");
  const semantic = triggers.find((tr) => tr.type === "semantic");
  const keywords = semantic ? (semantic.payload as { keywords: string[] }).keywords : [];
  const hr = lang === "hr";

  const commitTime = (triggerId: string | null, when: Date) => {
    if (when.getTime() <= now) {
      Alert.alert(hr ? "To je prošlo" : "That has passed", hr ? "Sljedeća godina ili odmah?" : "Next year or right now?", [
        { text: hr ? "Odustani" : "Cancel", style: "cancel" },
        {
          text: hr ? "Sljedeća godina" : "Next year",
          onPress: () => {
            const d = new Date(when);
            d.setFullYear(d.getFullYear() + 1);
            void commitTime(triggerId, d);
          },
        },
        { text: hr ? "Odmah" : "Now", onPress: () => void commitTime(triggerId, new Date(now + 60_000)) },
      ]);
      return;
    }
    const iso = toLocalIso(when.getTime());
    if (triggerId) void mutate([{ op: "set_time", triggerId, iso }], `${hr ? "Vrijeme" : "Time"} → ${fmtDateTime(when.getTime())}`);
    else
      void mutate(
        // Not "ručno": that describes how the reminder was made, which is the app's business, not the
        // user's. The row already shows the date — the label only has to say what kind of thing this is.
        [{ op: "add_trigger", trigger: { type: "time", payload: { iso }, label: hr ? "Podsjetnik" : "Reminder", certainty: 1, fireAt: when.getTime() } }],
        `${hr ? "+ podsjetnik" : "+ reminder"} ${fmtDateTime(when.getTime())}`,
      );
  };

  const openPicker = (triggerId: string | null, initial: number) => {
    setPicker({ kind: "time", triggerId, value: new Date(Math.max(initial, now + 3_600_000)) });
  };

  /** Wrong birthday? Change the anchor once — every reminder bound to it (in every note) moves with it. */
  const commitAnchor = async (anchor: Anchor, d: Date) => {
    const monthDay = formatMonthDay(d.getMonth() + 1, d.getDate());
    const bound = (await triggersRepo.byAnchor(db(), anchor.id)).filter((x) => x.state === "active");
    const notes = new Set(bound.map((x) => x.noteId)).size;
    const apply = () =>
      void mutate([{ op: "set_anchor", anchorId: anchor.id, monthDay, ...(anchor.kind === "oneoff" ? { year: d.getFullYear() } : {}) }], `${anchor.label} → ${fmtMonthDay(monthDay)}`);
    if (bound.length <= 1) return apply();
    Alert.alert(
      `${anchor.label} → ${fmtMonthDay(monthDay)}`,
      hr ? `Ovo pomiče ${bound.length} podsjetnika u ${notes} ${notes === 1 ? "bilješci" : "bilješke"}.` : `This moves ${bound.length} reminders in ${notes} note${notes === 1 ? "" : "s"}.`,
      [
        { text: hr ? "Odustani" : "Cancel", style: "cancel" },
        { text: hr ? "Pomakni" : "Move", onPress: apply },
      ],
    );
  };

  const openAnchorPicker = (anchor: Anchor) => {
    setPicker({ kind: "anchor", anchor, value: anchor.monthDay ? nextOccurrence(anchor.monthDay, clock) : new Date(now) });
  };

  /**
   * A tap on a dated reminder goes straight to the calendar — changing the date is what people come here for,
   * and a seven-item menu in front of it made the common case the slowest one. Everything else moved to the
   * long press.
   */
  const onTriggerPress = (tr: Trigger) => {
    if (tr.type === 'semantic' || tr.state !== 'active') return;
    const anchor = tr.anchorId ? anchors.get(tr.anchorId) : undefined;
    if (anchor) return openAnchorPicker(anchor);
    if (tr.type === 'time') return openPicker(tr.id, tr.fireAt ?? now);
    onTriggerMenu(tr);
  };

  const onTriggerMenu = (tr: Trigger) => {
    // The semantic trigger is not a reminder: it is what makes the note findable in six months, and it has no
    // date to move, nothing to finish, and deleting it would only make the note unsearchable while pretending
    // to be a tidy-up. So it gets no menu at all — see the "Pronalazi se po…" row below.
    if (tr.type === "semantic") return;
    const isTimed = tr.type === "time" || tr.type === "anchor";
    const buttons: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [];
    // No "change date" entry: the tap already opens the calendar. Repeating it here is what made the menu long.
    if (isTimed && tr.state === "active") {
      buttons.push({ text: hr ? "Tjedan ranije" : "A week earlier", onPress: () => void mutate([{ op: "shift_offset", triggerId: tr.id, days: -7 }]) });
      buttons.push({ text: hr ? "Tjedan kasnije" : "A week later", onPress: () => void mutate([{ op: "shift_offset", triggerId: tr.id, days: 7 }]) });
    }
    // The menu's "Riješeno ✓" is the same act as the row's tick, so it sounds the same. It goes through
    // mutate() rather than setReminderDone(), hence the explicit ding here.
    if (tr.state === "active")
      buttons.push({
        text: hr ? "Riješeno ✓" : "Done ✓",
        onPress: () => {
          playDing();
          void mutate([{ op: "set_state", triggerId: tr.id, state: "done" }]);
        },
      });
    buttons.push({
      text: hr ? "Obriši podsjetnik" : "Delete reminder",
      style: "destructive",
      onPress: () => void mutate([{ op: "remove_trigger", triggerId: tr.id }], hr ? "Podsjetnik obrisan" : "Reminder deleted"),
    });
    buttons.push({ text: hr ? "Odustani" : "Cancel", style: "cancel" });
    Alert.alert(tr.label ?? (hr ? "Podsjetnik" : "Reminder"), tr.fireAt ? fmtDateTime(tr.fireAt) : undefined, buttons);
  };

  const deleteNote = () => {
    Alert.alert(hr ? "Obrisati bilješku?" : "Delete note?", hr ? "Nestaju i svi podsjetnici." : "All reminders go with it.", [
      { text: hr ? "Odustani" : "Cancel", style: "cancel" },
      {
        text: hr ? "Obriši" : "Delete",
        style: "destructive",
        onPress: async () => {
          await notesRepo.remove(db(), note.id);
          router.back();
        },
      },
    ]);
  };

  /** One tap on a reminder's tick. When it was the last one open, the note archives itself and says so. */
  const toggleReminder = async (tr: Trigger) => {
    if (!id) return;
    if (tr.state === "active") {
      const archived = await setReminderDone(id, tr.id);
      // Ticking one off is a light tap; finishing the last one is the success pattern — the difference is felt
      // rather than read, and unlike a sound it still lands when the phone is on silent, which is most of the time.
      void (archived ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => undefined);
      setUndo(archived ? (hr ? "Sve riješeno — bilješka je u Riješeno" : "All done — note moved to Done") : hr ? "Podsjetnik riješen" : "Reminder done");
    } else {
      await setReminderActive(id, tr.id);
      void Haptics.selectionAsync().catch(() => undefined);
      setUndo(hr ? "Podsjetnik vraćen" : "Reminder reopened");
    }
    setTimeout(() => setUndo(null), 5000);
  };

  /** Finish the whole note, or reopen it — the same control both ways. */
  const toggleNoteDone = async () => {
    if (!id) return;
    const next = !note.archived;
    await setNoteDone(id, next);
    void (next ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync()).catch(() => undefined);
    setUndo(next ? (hr ? "Riješeno" : "Done") : hr ? "Vraćeno među aktivne" : "Reopened");
    setTimeout(() => setUndo(null), 5000);
  };

  const startEdit = () => {
    setDraft(note.summary ?? note.rawText);
    setEditing(true);
  };
  /**
   * Save an edited description. The reminders were reasoned out of the OLD text, so when the new text differs
   * substantially we offer to read it again — offer, never silently, because re-reading moves reminders and a
   * hand-made change is sacred (hard rule 3).
   */
  const saveBody = async () => {
    setEditingBody(false);
    const next = bodyDraft.trim();
    if (!next || next === note.rawText) return;
    await setNoteText(note.id, next);
    if (!shouldOfferReread(note.rawText, next).ask) return;
    Alert.alert(
      hr ? "Pročitati ponovno?" : "Read it again?",
      hr
        ? "Tekst se dosta promijenio. Mogu ponovno pročitati bilješku i posložiti podsjetnike prema novom tekstu."
        : "The text changed quite a bit. I can read the note again and set the reminders from the new text.",
      [
        { text: hr ? "Ostavi kako je" : "Leave as is", style: "cancel" },
        { text: hr ? "Pročitaj ponovno" : "Read again", onPress: () => void retryEnrich(note.id) },
      ],
    );
  };

  const saveSummary = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== (note.summary ?? "")) void mutate([{ op: "edit_summary", text: v }], hr ? "Sažetak spremljen" : "Summary saved");
  };

  return (
    <>
      <Screen scroll edges={["top"]} bottomInset={80}>
        {/* Back on the left, "done" on the right — the two things you do to a note, on the same line. */}
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={hr ? "Natrag" : "Back"}
            hitSlop={10}
            style={({ pressed }) => [styles.back, { backgroundColor: t.c.glass, borderColor: t.c.glassBorder, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="chevron-back" size={20} color={t.c.fg} />
          </Pressable>
          {/* A toggle, not a disappearing action: it stays put and changes its look, so the way back is in the
              same place as the way forward. Filled = done, outlined = still open. */}
          <Pressable
            onPress={() => void toggleNoteDone()}
            accessibilityRole="button"
            accessibilityState={{ checked: note.archived }}
            accessibilityLabel={note.archived ? (hr ? "Vrati među aktivne" : "Reopen note") : hr ? "Sve riješeno" : "Mark all done"}
            hitSlop={10}
            style={({ pressed }) => [
              styles.doneChip,
              {
                backgroundColor: note.archived ? t.c.accent : t.c.glass,
                borderColor: note.archived ? t.c.accent : t.c.glassBorder,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="checkmark-done" size={18} color={note.archived ? t.c.onAccent : t.c.fg2} />
          </Pressable>
        </View>
        <Mono tone="muted" style={{ marginTop: S.lg }}>
          {fmtDate(note.createdAt)} · {fmtRelative(note.createdAt, now, lang)}
          {note.category ? ` · ${note.category.replace(/_/g, " ")}` : ""}
        </Mono>

        {editing ? (
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onBlur={saveSummary}
            onSubmitEditing={saveSummary}
            returnKeyType="done"
            style={[styles.summaryInput, { color: t.c.fg, borderColor: t.c.accent }]}
            maxLength={120}
          />
        ) : (
          <Pressable onPress={startEdit} accessibilityRole="button" accessibilityLabel={hr ? "Uredi sažetak" : "Edit summary"}>
            {/* Long titles step down a size so they don't wrap into a wall of four lines */}
            <Display size={(note.summary ?? note.rawText).length > 34 ? "xl" : "xxl"} weight="semi" style={{ marginTop: S.sm }}>
              {note.summary ?? note.rawText}
            </Display>
          </Pressable>
        )}

        {/* The description is editable too. It is what the reasoning was built from, so changing it
            substantially offers a re-read (shouldOfferReread decides what counts as substantial). */}
        {editingBody ? (
          <View>
            <TextInput
              autoFocus
              multiline
              value={bodyDraft}
              onChangeText={setBodyDraft}
              style={[styles.bodyInput, { color: t.c.fg2, borderColor: t.c.accent }]}
              maxLength={2000}
              accessibilityLabel={hr ? "Uredi tekst bilješke" : "Edit note text"}
            />
            {/* An explicit Save, rather than saving on blur: tapping somewhere else to commit an edit is a
                guess, and the re-read question that follows deserves a deliberate action behind it. */}
            <View style={styles.reminderActions}>
              <Button title={hr ? "Spremi" : "Save"} variant="primary" size="sm" icon="checkmark" disabled={!bodyDraft.trim() || bodyDraft.trim() === note.rawText} onPress={() => void saveBody()} />
              <Button
                title={hr ? "Odustani" : "Cancel"}
                variant="ghost"
                size="sm"
                onPress={() => {
                  setEditingBody(false);
                  setBodyDraft("");
                }}
              />
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              setBodyDraft(note.rawText);
              setEditingBody(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={hr ? "Uredi tekst bilješke" : "Edit note text"}
          >
            <Body tone="fg2" style={{ marginTop: S.md }}>
              {note.rawText}
            </Body>
          </Pressable>
        )}

        {note.status === "failed" ? (
          <Button
            title={hr ? "Pokušaj ponovno pročitati" : "Try reading again"}
            variant="soft"
            size="sm"
            style={{ alignSelf: "flex-start", marginTop: S.md }}
            onPress={() => void retryEnrich(note.id)}
          />
        ) : note.status === "pending" ? (
          // Same animation as on Today: opening the note mid-enrichment must explain itself, not show a dead screen.
          <View style={{ marginTop: S.lg }}>
            <ReadingCard compact />
          </View>
        ) : null}

        {/* A question can be answered right here — you should not have to go back to Danas to answer it. */}
        {note.status === "needs_input" && note.questions.length > 0 ? (
          <View style={{ marginTop: S.lg }}>
            <ClarifyCard note={note} />
          </View>
        ) : null}

        {anchors.size > 0 ? (
          <View style={{ marginTop: S.xxl }}>
            <Label>{hr ? "Datumi" : "Dates"}</Label>
            <Hairline style={{ marginTop: S.sm }} />
            {Array.from(anchors.values()).map((a) => (
              <Pressable
                key={a.id}
                onPress={() => openAnchorPicker(a)}
                accessibilityRole="button"
                accessibilityLabel={hr ? `Promijeni datum: ${a.label}` : `Change date: ${a.label}`}
                style={({ pressed }) => [styles.anchorRow, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Mono tone="accent" size="lg" style={{ width: 22, textAlign: "center" }}>
                  ◉
                </Mono>
                <Body style={{ flex: 1 }}>{a.label}</Body>
                <Mono tone="fg">
                  {a.monthDay ? fmtMonthDay(a.monthDay) : "—"}
                  {a.year ? a.year : ""}
                </Mono>
                <Mono tone="muted" size="md">
                  ›
                </Mono>
              </Pressable>
            ))}
            <Mono tone="muted" size="xs" style={{ marginTop: S.xs }}>
              {hr ? "krivi datum? tapni — svi vezani podsjetnici se pomiču sami" : "wrong date? tap — every bound reminder moves with it"}
            </Mono>
          </View>
        ) : null}

        <View style={{ marginTop: S.xxl }}>
          <View style={styles.sectionHead}>
            <Label>{hr ? "Podsjetnici" : "Reminders"}</Label>
            <Mono tone="muted" size="xs">
              {progress ? `${progress.done}/${progress.total} ${hr ? "riješeno" : "done"}` : ""}
            </Mono>
          </View>
          <Hairline style={{ marginTop: S.sm }} />
          {reminders.map((tr) => (
            <TriggerRow
              key={tr.id}
              trigger={tr}
              now={now}
              lang={lang}
              anchorLabel={tr.anchorId ? anchors.get(tr.anchorId)?.label : null}
              onPress={() => onTriggerPress(tr)}
              onLongPress={() => onTriggerMenu(tr)}
              onToggleDone={() => void toggleReminder(tr)}
            />
          ))}
          <View style={styles.reminderActions}>
            <Button title={hr ? "+ Dodaj podsjetnik" : "+ Add reminder"} variant="ghost" size="sm" onPress={() => openPicker(null, now + 86_400_000)} />
          </View>
        </View>

        {/* Not a reminder — this is what makes the note findable in six months, so it has no tick and no menu.
            Shown as plain keywords rather than a row that looks like something you could finish. */}
        {keywords.length > 0 ? (
          <View style={{ marginTop: S.xl }}>
            <View style={styles.searchRow}>
              <Ionicons name="sparkles-outline" size={14} color={t.c.muted} />
              <Mono tone="muted" size="xs" style={{ flex: 1 }}>
                {hr ? "Pronalazi se po" : "Found by"}: {keywords.join(" · ")}
              </Mono>
            </View>
          </View>
        ) : null}

        {/* Actions: one glass list, each row says what it does and why you'd want it. */}
        <View style={{ marginTop: S.xxl }}>
          <Label>{hr ? "Radnje" : "Actions"}</Label>
          <Glass radius={R.lg} style={{ marginTop: S.sm }}>
            {(
              [
                note.status !== "pending" && note.status !== "failed"
                  ? {
                      icon: "refresh-outline" as const,
                      title: hr ? "Pročitaj ponovno" : "Read again",
                      sub: hr ? "Ponovno izvuci podsjetnike iz teksta. Tvoje ručne izmjene ostaju." : "Re-extract reminders from the text. Your manual edits stay.",
                      onPress: () => void retryEnrich(note.id),
                    }
                  : null,
                {
                  icon: (note.archived ? "arrow-undo-outline" : "archive-outline") as "arrow-undo-outline" | "archive-outline",
                  title: note.archived ? (hr ? "Vrati među aktivne" : "Reopen note") : hr ? "Označi riješenim" : "Mark as done",
                  sub: note.archived
                    ? hr
                      ? "Bilješka se opet pojavljuje u listi i podsjetnicima."
                      : "The note shows up in lists and reminders again."
                    : hr
                      ? "Makni iz liste; podsjetnici se više ne javljaju. Tekst ostaje pretraživ."
                      : "Hide from lists; reminders stop. Text stays searchable.",
                  onPress: () => void setNoteDone(note.id, !note.archived),
                },
                {
                  icon: "trash-outline" as const,
                  title: hr ? "Obriši bilješku" : "Delete note",
                  sub: hr ? "Trajno, zajedno sa svim podsjetnicima." : "Permanently, with all its reminders.",
                  danger: true,
                  onPress: deleteNote,
                },
              ] as Array<{ icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; sub: string; danger?: boolean; onPress: () => void } | null>
            )
              .filter((a): a is NonNullable<typeof a> => a !== null)
              .map((a, i, arr) => (
                <Pressable key={a.title} onPress={a.onPress} accessibilityRole="button" accessibilityLabel={a.title} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}>
                  <View style={[styles.actionIcon, { backgroundColor: a.danger ? t.c.dangerSoft : t.c.accentSoft }]}>
                    <Ionicons name={a.icon} size={17} color={a.danger ? t.c.danger : t.c.ion} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body tone={a.danger ? "danger" : "fg"}>{a.title}</Body>
                    <Mono tone="muted" size="xs" style={{ marginTop: 2 }}>
                      {a.sub}
                    </Mono>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={t.c.muted} />
                  {i < arr.length - 1 ? <View style={[styles.actionHair, { backgroundColor: t.c.hairline }]} /> : null}
                </Pressable>
              ))}
          </Glass>
        </View>
      </Screen>

      {/* Glass, not a white slab: `backgroundColor: t.c.fg` painted a bright bar across the olive-black
          ground and was the one element on this screen that ignored the palette. */}
      {undo ? (
        <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(150)} style={styles.snack}>
          <Glass variant="strong" radius={R.pill}>
            <View style={styles.snackInner}>
              <Ionicons name="checkmark-circle" size={16} color={t.c.accent} />
              <Body size="sm" style={{ flex: 1 }} numberOfLines={1}>
                {undo}
              </Body>
              <Pressable
                onPress={async () => {
                  setUndo(null);
                  if (id) await undoLast(id);
                }}
                hitSlop={10}
              >
                <Body size="sm" style={{ color: t.c.signal, fontFamily: FONT.bodySemibold }}>
                  {hr ? "Poništi" : "Undo"}
                </Body>
              </Pressable>
            </View>
          </Glass>
        </Animated.View>
      ) : null}

      <DatePickerSheet
        visible={!!picker}
        value={picker?.value ?? new Date()}
        mode={picker?.kind === "anchor" ? "date" : "datetime"}
        title={picker?.kind === "anchor" ? picker.anchor.label : hr ? "Kad da te podsjetim?" : "When should I remind you?"}
        subtitle={picker?.kind === "anchor" ? null : hr ? "Vrijeme je neobavezno — dan je dovoljan." : "The time is optional — a day is enough."}
        // Adding a reminder offers date + time, but never demands the time.
        dayOnlyLabel={picker?.kind === "anchor" ? null : hr ? "Bez vremena" : "No time"}
        dayOnlyAt={DEFAULT_ANCHOR_TIME}
        dayOnlyTitle={hr ? "Treba li točno vrijeme?" : "Does it need a time?"}
        timeLabel={hr ? "Odaberi vrijeme" : "Pick a time"}
        onCancel={() => setPicker(null)}
        onConfirm={(d) => {
          const p = picker;
          setPicker(null);
          if (!p) return;
          if (p.kind === "anchor") void commitAnchor(p.anchor, d);
          else commitTime(p.triggerId, d);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bodyInput: {
    marginTop: S.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: R.md,
    padding: S.md,
    fontFamily: FONT.body,
    fontSize: T.md,
    lineHeight: 22,
    minHeight: 90,
    textAlignVertical: "top",
  },
  summaryInput: { fontFamily: FONT.display, fontSize: T.xxl, lineHeight: 38, letterSpacing: -0.8, marginTop: S.sm, borderBottomWidth: 1, paddingBottom: 4 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  anchorRow: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md },
  back: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", marginTop: S.xs },
  action: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md, position: "relative" },
  actionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  actionHair: { position: "absolute", left: 62, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: S.sm },
  doneChip: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  searchRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  reminderActions: { flexDirection: "row", alignItems: "center", marginTop: S.sm, flexWrap: "wrap" },
  snack: { position: "absolute", left: S.lg, right: S.lg, bottom: S.xl },
  snackInner: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md },
});
