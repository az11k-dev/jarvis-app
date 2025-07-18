import {Alert} from 'react-native';
import {scheduleReminder, parseSecondsFromPhrase, parseReminderDetails} from './notificationsService';
import {getLatestCommits} from "../core/github/commits";
import {createGitHubRepo} from "../core/github/createRepo";
import {deleteGitHubRepo} from "../core/github/deleteRepo";

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
        const parsed = parseReminderDetails(userMessage);

        if (userMessage.toLowerCase().includes('напомни') && parsed) {
            const {reminderText, seconds} = parsed;

            setDisplayedText(`Сэр, установлено напоминание: "${reminderText}" через ${Math.floor(seconds / 60)} минут.`);
            setJarvisResponseText(`Сэр, установлено напоминание: "${reminderText}" через ${Math.floor(seconds / 60)} минут.`);
            await speak(`Сэр, установлено напоминание: ${reminderText} через ${Math.floor(seconds / 60)} минут.`);
            await scheduleReminder(reminderText, seconds);
            setIsLoading(false);
            return;
        }

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

        if (jarvisReply.toLowerCase().includes('напомни') && parseSecondsFromPhrase(jarvisReply)) {
            const seconds = parseSecondsFromPhrase(jarvisReply);
            const reminderText = jarvisReply.replace(/.*напомни.*(через.*)/i, '').trim() || 'о задаче';
            const confirmation = `Сэр, установлено напоминание: "${reminderText}" через ${Math.floor(seconds > 60 ? (seconds / 60) : seconds)} ${seconds > 60 ? "минут" : "секунд"}.`;

            setDisplayedText(confirmation);
            setJarvisResponseText(confirmation);
            await speak(confirmation);
            await scheduleReminder(reminderText, seconds);
            return;
        }

        if (jarvisReply.toLowerCase().startsWith('create_github_repo')) {
            const repoName = jarvisReply.replace('create_github_repo', '').trim();
            if (!repoName) {
                await speak('Сэр, я не расслышал название репозитория.');
                return;
            }

            try {
                const repoUrl = await createGitHubRepo({name: repoName});
                const responseText = `Сэр, репозиторий ${repoName} успешно создан. ${repoUrl}`;
                console.log(repoName);
                setDisplayedText(responseText);
                setJarvisResponseText(responseText);
                await speak(responseText);
            } catch (error) {
                const errText = `Не удалось создать репозиторий: ${error.message}`;
                setDisplayedText(errText);
                setJarvisResponseText(errText);
                await speak(errText);
            }
            return;
        }

        // === GitHub: Delete Repository ===
        if (jarvisReply.toLowerCase().startsWith('delete_github_repo')) {
            const repoName = jarvisReply.replace('delete_github_repo', '').trim();
            if (!repoName) {
                await speak('Сэр, я не расслышал, какой репозиторий нужно удалить.');
                return;
            }

            try {
                const confirmed = await new Promise((resolve) => {
                    Alert.alert(
                        'Подтвердите удаление',
                        `Вы уверены, что хотите удалить репозиторий: ${repoName}?`,
                        [
                            {text: 'Отмена', style: 'cancel', onPress: () => resolve(false)},
                            {text: 'Удалить', style: 'destructive', onPress: () => resolve(true)},
                        ],
                    );
                });

                if (!confirmed) {
                    await speak('Удаление отменено, сэр.');
                    return;
                }

                const deleted = await deleteGitHubRepo('az11k-dev', repoName);
                if (deleted) {
                    const msg = `Сэр, репозиторий ${repoName} был успешно удалён.`;
                    setJarvisResponseText(msg);
                    setDisplayedText(msg);
                    await speak(msg);
                }
            } catch (error) {
                const errText = `Не удалось удалить репозиторий: ${error.message}`;
                setDisplayedText(errText);
                setJarvisResponseText(errText);
                await speak(errText);
            }

            return;
        }

        if (jarvisReply.toLowerCase().startsWith('get_latest_commits')) {
            const number = parseInt(jarvisReply.replace('get_latest_commits', '').trim()) || 5;
            try {
                const commits = await getLatestCommits(number);
                if (!commits.length) {
                    await speak("Сэр, не найдено ни одного коммита.");
                    return;
                }

                const commitMessages = commits.map(
                    c => `— ${c.author}: ${c.message.split('\n')[0]}`
                ).join('\n');

                const responseText = `Сэр, вот последние коммиты:\n${commitMessages}`;
                setDisplayedText(responseText);
                setJarvisResponseText(responseText);
                await speak(responseText);
            } catch (error) {
                const errText = `Не удалось получить коммиты: ${error.message}`;
                setDisplayedText(errText);
                setJarvisResponseText(errText);
                await speak(errText);
            }
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