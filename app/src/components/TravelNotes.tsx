import { useState } from 'react';
import { Text, View } from 'react-native';
import { buildNotes, compactNote } from '../../../src/notes';
import { Button, useUI } from './ui';

export function TravelNotes({ messages, serviceMessages = [], title = 'Travel notes' }: { messages: string[]; serviceMessages?: string[]; title?: string }) {
  const { styles } = useUI();
  const [expanded, setExpanded] = useState(false);
  const [sourceText, setSourceText] = useState(false);
  const notes = [...buildNotes(serviceMessages, 'service'), ...buildNotes(messages)];
  if (!notes.length) return null;
  return <View style={{ gap: 8 }}>
    <Button label={expanded ? 'Hide notes' : title} selected={expanded} onPress={() => setExpanded(value => !value)} />
    {expanded ? <>
      {notes.map(note => <View key={`${note.title}:${note.message}`} style={styles.card}>
        <Text style={styles.label}>{note.title}</Text>
        <Text style={styles.small}>{(note.details ?? [note.message]).map(value => compactNote(value, note.kind === 'service')).join(' · ')}</Text>
        {sourceText ? note.details?.map(detail => <Text key={detail} style={styles.small}>{detail}</Text>) : null}
      </View>)}
      {notes.some(note => note.details) ? <Button label={sourceText ? 'Hide full text' : 'Show full text'}
        onPress={() => setSourceText(value => !value)} /> : null}
    </> : null}
  </View>;
}
