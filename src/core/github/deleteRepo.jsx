export async function deleteGitHubRepo(owner, repo) {
    const token = process.env.EXPO_PUBLIC_GITHUB_TOKEN_KEY;
    if (!token) throw new Error('GitHub token not found.');

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: 'DELETE',
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
        },
    });

    if (res.status === 204) {
        console.log(`✅ Repo '${repo}' deleted successfully.`);
        return true;
    } else {
        const error = await res.json().catch(() => ({}));
        console.error('GitHub Delete Error:', error);
        throw new Error(`Failed to delete repo: ${error?.message || res.statusText}`);
    }
}