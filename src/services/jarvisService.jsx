import {Alert} from 'react-native';
import {speakJarvisResponse} from './ttsService';
import {SYSTEM_MESSAGE} from '../utils/constants';

const openaiApiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

if (!openaiApiKey) {
    Alert.alert('OpenAI API Key Missing', 'Please set your OpenAI API key in app.json');
}

function stripMarkdown(text) {
    return text
        .replace(/[*~`#>-]+/g, '')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/^\s*\n/gm, '')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\n{2,}/g, '\n');
}

function chooseModelByText(text) {
    const searchKeywords = [
        'найди', 'поиск', 'ищи', 'кто такой', 'что такое', 'что значит',
        'who is', 'what is', 'search', 'look up', 'how to', 'latest', 'news', 'define'
    ];

    const lowerText = text.toLowerCase();

    return searchKeywords.some(keyword => lowerText.includes(keyword))
        ? 'gpt-4o-mini-search-preview-2025-03-11'
        : 'gpt-4o-mini';
}

export const processAudioWithOpenAI = async ({
                                                 audioUri,
                                                 chatHistory,
                                                 setChatHistory,
                                                 setDisplayedText,
                                                 setJarvisResponseText,
                                                 speak,
                                                 openCamera,
                                                 openYoutube,
                                                 openTelegram,
                                                 setIsLoading,
                                             }) => {
    setIsLoading(true);
    setJarvisResponseText('Думаю...');
    setDisplayedText('Думаю...');

    try {
        const formData = new FormData();
        formData.append('file', {
            uri: audioUri,
            name: 'recording.m4a',
            type: 'audio/m4a',
        });
        formData.append('model', 'whisper-1');

        const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${openaiApiKey}`,
                'Content-Type': 'multipart/form-data',
            },
            body: formData,
        });

        const whisperData = await whisperResponse.json();

        if (!whisperResponse.ok) {
            throw new Error(whisperData.error?.message || 'Whisper API Error');
        }

        const userMessage = whisperData.text;
        setDisplayedText(`Вы сказали: "${userMessage}"\nJARVIS думает...`);
        setJarvisResponseText(`Вы сказали: "${userMessage}"\nJARVIS думает...`);

        const updatedHistory = [...chatHistory, {role: 'user', content: userMessage}];
        setChatHistory(updatedHistory);

        const chosenModel = chooseModelByText(userMessage);

        const completion = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: chosenModel,
                messages: updatedHistory,
            }),
        });

        const responseData = await completion.json();

        const jarvisReply = stripMarkdown(responseData.choices?.[0]?.message?.content) || '...';



        if (jarvisReply.toLowerCase().includes('open_camera')) {
            setJarvisResponseText('Сэр, открываю камеру...');
            setDisplayedText('Сэр, открываю камеру...');
            await speak('Сэр, открываю камеру.');
            await openCamera();
            return;
        }

        if (jarvisReply.toLowerCase().includes('open_telegram')) {
            setJarvisResponseText('Сэр, открываю Telegram...');
            setDisplayedText('Сэр, открываю Telegram...');
            await openTelegram();
            return;
        }

        if (jarvisReply.toLowerCase().includes('open_youtube')) {
            const parts = jarvisReply.split('open_youtube');
            const query = parts[1]?.trim(); // Получаем всё, что после команды
            const speakText = query
                ? `Сэр, открываю YouTube по запросу: ${query}...`
                : 'Сэр, открываю YouTube...';

            setJarvisResponseText(speakText);
            setDisplayedText(speakText);
            await openYoutube(query);
            return;
        }

        setJarvisResponseText(jarvisReply);
        await speak(jarvisReply);
    } catch (err) {
        console.error('Jarvis error:', err);
        setJarvisResponseText('Произошла ошибка при обработке аудио.');
        setDisplayedText('Произошла ошибка при обработке аудио.');
        Alert.alert('Ошибка', err.message);
    } finally {
        setIsLoading(false);
    }
};