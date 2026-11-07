import React, { useRef } from 'react';
import { ScrollView, Text, ToastAndroid, Platform, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { styles } from '../styles/mainStyles';

const LABELS = { user: 'ВЫ', jarvis: 'J.A.R.V.I.S.', error: 'СИСТЕМА' };

export default function Transcript({ messages }) {
  const scrollRef = useRef(null);

  const copy = (text) => {
    Clipboard.setStringAsync(text);
    if (Platform.OS === 'android') {
      ToastAndroid.show('Скопировано', ToastAndroid.SHORT);
    }
  };

  if (!messages.length) {
    return (
      <View style={styles.transcriptEmpty}>
        <Text style={styles.hint}>
          Скажите «Джарвис, …» — например,{'\n'}
          «Джарвис, какая погода в Ташкенте?»
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.transcript}
      contentContainerStyle={styles.transcriptContent}
      onContentSizeChange={() =>
        scrollRef.current?.scrollToEnd({ animated: true })
      }
    >
      {messages.map((m) => (
        <View
          key={m.id}
          style={[
            styles.message,
            m.role === 'user' && styles.messageUser,
            m.role === 'error' && styles.messageError,
          ]}
        >
          <Text style={[styles.messageLabel, styles[`label_${m.role}`]]}>
            {LABELS[m.role]}
          </Text>
          <Text
            style={[styles.messageText, m.role === 'user' && styles.userText]}
            onLongPress={() => copy(m.text)}
          >
            {m.text}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
