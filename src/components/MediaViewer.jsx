import React, { useSyncExternalStore } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { mediaViewer } from '../services/mediaViewer';
import { COLORS, FONTS } from '../styles/mainStyles';

/**
 * Full-screen photo or video that JARVIS puts over the HUD (e.g. from a
 * Telegram chat). ✕ or the back button closes it; so does «Джарвис, закрой».
 */
export default function MediaViewer() {
  const item = useSyncExternalStore(
    mediaViewer.subscribe,
    mediaViewer.getSnapshot
  );
  return (
    <Modal
      visible={!!item}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={mediaViewer.hide}
    >
      <View style={styles.screen}>
        {item?.kind === 'photo' && (
          <Image
            source={{ uri: item.uri }}
            style={styles.media}
            resizeMode="contain"
          />
        )}
        {item?.kind === 'video' && <Video key={item.uri} item={item} />}
        <View style={styles.bar}>
          <Text style={styles.title} numberOfLines={1}>
            {item?.title || ''}
          </Text>
          <Pressable
            onPress={mediaViewer.hide}
            hitSlop={16}
            accessibilityLabel="Close"
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Video({ item }) {
  const player = useVideoPlayer(item.uri, (p) => {
    p.loop = !!item.loop;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.media}
      contentFit="contain"
      nativeControls
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  media: { flex: 1 },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 44,
    paddingBottom: 12,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(5, 8, 15, 0.6)',
  },
  title: {
    flex: 1,
    marginRight: 16,
    color: COLORS.cyan,
    fontFamily: FONTS.readout,
    fontSize: 13,
    letterSpacing: 2,
  },
  close: { color: COLORS.cyan, fontSize: 24 },
});
