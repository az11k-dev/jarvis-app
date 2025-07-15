import React from 'react';
import { View, ScrollView, Text, ActivityIndicator } from 'react-native';
import { styles } from '../styles/mainStyles';

export default function ResponseBox({ isLoading, displayedText, scrollRef }) {
    return (
        <View style={styles.thirdCon}>
            {isLoading && <ActivityIndicator size="large" color="#00ff00" style={{ marginTop: 10 }} />}
            <ScrollView
                ref={scrollRef}
                style={styles.responseScrollView}
                contentContainerStyle={styles.responseScrollViewContent}
            >
                <Text style={styles.resp}>
                    {displayedText || (isLoading ? 'Думаю...' : 'Жду ваших указаний, сэр.')}
                </Text>
            </ScrollView>
        </View>
    );
}