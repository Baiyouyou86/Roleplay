// ---------- 数据存储与初始化 ----------
const STORAGE_KEYS = {
    CHARACTERS: 'rp_characters',
    PRESETS: 'rp_presets',
    API_CONFIG: 'rp_api_config',
    CHAT_PREFIX: 'rp_chat_'
};

// 默认预设
const DEFAULT_PRESET = {
    id: 'default',
    name: '默认预设',
    systemPrompt: '',
    temperature: 0.8,
    maxTokens: 1024
};

new Vue({
    el: '#app',
    data: {
        // UI状态
        sidebarCollapsed: false,
        showCharEditor: false,
        showPresetEditor: false,
        isGenerating: false,
        abortController: null,
        
        // 数据
        characters: [],
        presets: [],
        currentCharId: null,
        currentMessages: [],
        currentPresetId: 'default',
        
        // 编辑中的对象
        editingChar: this.getEmptyChar(),
        editingPreset: { ...DEFAULT_PRESET },
        
        // API配置
        apiConfig: {
            key: '',
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-3.5-turbo'
        },
        
        // 输入
        inputMessage: '',
        
        // 引用
        fileInput: null
    },
    
    computed: {
        currentChar() {
            return this.characters.find(c => c.id === this.currentCharId);
        },
        currentPreset() {
            return this.presets.find(p => p.id === this.currentPresetId) || DEFAULT_PRESET;
        }
    },
    
    methods: {
        // ---------- 初始化 ----------
        getEmptyChar() {
            return {
                id: '',
                name: '',
                avatar: '',
                description: '',
                greeting: '',
                scenario: '',
                worldBook: {},      // 解析后的对象
                worldBookStr: '{}',
                regexRules: [],      // 解析后的数组
                regexStr: '[]'
            };
        },
        
        loadFromStorage() {
            try {
                const chars = localStorage.getItem(STORAGE_KEYS.CHARACTERS);
                if (chars) this.characters = JSON.parse(chars);
                
                const presets = localStorage.getItem(STORAGE_KEYS.PRESETS);
                if (presets) {
                    this.presets = JSON.parse(presets);
                } else {
                    this.presets = [DEFAULT_PRESET];
                }
                
                const api = localStorage.getItem(STORAGE_KEYS.API_CONFIG);
                if (api) this.apiConfig = JSON.parse(api);
                
                // 加载上次选中的角色和对话
                const lastChar = localStorage.getItem('rp_last_char');
                if (lastChar && this.characters.find(c => c.id === lastChar)) {
                    this.currentCharId = lastChar;
                    this.loadChatHistory(lastChar);
                }
            } catch(e) {
                console.warn('读取存储失败', e);
            }
        },
        
        saveCharacters() {
            localStorage.setItem(STORAGE_KEYS.CHARACTERS, JSON.stringify(this.characters));
        },
        
        savePresets() {
            localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(this.presets));
        },
        
        saveApiConfig() {
            localStorage.setItem(STORAGE_KEYS.API_CONFIG, JSON.stringify(this.apiConfig));
        },
        
        loadChatHistory(charId) {
            const key = STORAGE_KEYS.CHAT_PREFIX + charId;
            const saved = localStorage.getItem(key);
            if (saved) {
                this.currentMessages = JSON.parse(saved);
            } else {
                // 若无历史，尝试加入开场白
                const char = this.characters.find(c => c.id === charId);
                if (char && char.greeting) {
                    this.currentMessages = [{ role: 'assistant', content: char.greeting }];
                } else {
                    this.currentMessages = [];
                }
            }
            this.$nextTick(() => this.scrollToBottom());
        },
        
        saveCurrentChat() {
            if (!this.currentCharId) return;
            const key = STORAGE_KEYS.CHAT_PREFIX + this.currentCharId;
            localStorage.setItem(key, JSON.stringify(this.currentMessages));
        },
        
        // ---------- 角色操作 ----------
        createNewCharacter() {
            this.editingChar = this.getEmptyChar();
            this.showCharEditor = true;
        },
        
        editCharacter(char) {
            this.editingChar = { ...char };
            // 同步字符串字段
            this.editingChar.worldBookStr = JSON.stringify(char.worldBook || {}, null, 2);
            this.editingChar.regexStr = JSON.stringify(char.regexRules || [], null, 2);
            this.showCharEditor = true;
        },
        
        saveCharacter() {
            const char = this.editingChar;
            if (!char.name) { alert('角色名不能为空'); return; }
            
            // 解析世界书和正则
            try {
                char.worldBook = JSON.parse(char.worldBookStr || '{}');
            } catch(e) { alert('世界书 JSON 格式错误'); return; }
            try {
                char.regexRules = JSON.parse(char.regexStr || '[]');
            } catch(e) { alert('正则规则 JSON 格式错误'); return; }
            
            if (char.id) {
                const idx = this.characters.findIndex(c => c.id === char.id);
                this.$set(this.characters, idx, { ...char });
            } else {
                char.id = Date.now() + '' + Math.random().toString(36);
                this.characters.push({ ...char });
                this.currentCharId = char.id;
            }
            
            this.saveCharacters();
            this.showCharEditor = false;
            
            if (this.currentCharId === char.id) {
                this.loadChatHistory(char.id);
            }
        },
        
        deleteCharacter(id) {
            if (!confirm('确定删除该角色及其所有对话记录？')) return;
            this.characters = this.characters.filter(c => c.id !== id);
            localStorage.removeItem(STORAGE_KEYS.CHAT_PREFIX + id);
            if (this.currentCharId === id) {
                this.currentCharId = this.characters.length ? this.characters[0].id : null;
                if (this.currentCharId) this.loadChatHistory(this.currentCharId);
                else this.currentMessages = [];
            }
            this.saveCharacters();
            this.showCharEditor = false;
        },
        
        switchCharacter(id) {
            if (this.currentCharId) this.saveCurrentChat();
            this.currentCharId = id;
            localStorage.setItem('rp_last_char', id);
            this.loadChatHistory(id);
        },
        
        // ---------- 文件导入 ----------
        importFromFile() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,.png';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                if (file.name.endsWith('.json')) {
                    const text = await file.text();
                    try {
                        const charData = JSON.parse(text);
                        this.importCharacterData(charData);
                    } catch(e) { alert('无效的 JSON 文件'); }
                } else if (file.name.endsWith('.png')) {
                    // 使用 exifr 解析 PNG 文本块
                    try {
                        const exif = await exifr.parse(file, { tiff: true, xmp: true, iptc: true });
                        // 角色卡通常存储在 "Description" 或自定义字段，我们尝试读取所有文本块
                        const segments = await exifr.segments(file);
                        let charData = null;
                        for (let seg of segments) {
                            if (seg && seg['tEXt'] && seg['tEXt'].keywords) {
                                const kw = seg['tEXt'].keywords;
                                if (kw.chara || kw.character || kw.ccv3) {
                                    try {
                                        charData = JSON.parse(kw.chara || kw.character || kw.ccv3);
                                        break;
                                    } catch(e) {}
                                }
                            }
                        }
                        if (!charData) {
                            // 尝试从 XMP 中获取
                            if (exif && exif.description) {
                                try { charData = JSON.parse(exif.description); } catch(e) {}
                            }
                        }
                        if (charData) {
                            this.importCharacterData(charData);
                        } else {
                            alert('PNG 中未找到角色卡数据');
                        }
                    } catch(e) {
                        alert('解析 PNG 失败: ' + e.message);
                    }
                }
            };
            input.click();
        },
        
        importCharacterData(data) {
            // 兼容常见角色卡格式 (SillyTavern, Agnai, Risu等)
            const imported = {
                id: '',
                name: data.name || data.char_name || '导入角色',
                avatar: data.avatar || '🧑',
                description: data.description || data.personality || '',
                greeting: data.first_mes || data.greeting || '',
                scenario: data.scenario || '',
                worldBook: data.world_book || data.character_book || {},
                regexRules: data.regex || []
            };
            this.editingChar = {
                ...imported,
                worldBookStr: JSON.stringify(imported.worldBook, null, 2),
                regexStr: JSON.stringify(imported.regexRules, null, 2)
            };
            this.showCharEditor = true;
        },
        
        // ---------- 预设管理 ----------
        openPresetEditor() {
            const preset = this.presets.find(p => p.id === this.currentPresetId);
            this.editingPreset = preset ? { ...preset } : { ...DEFAULT_PRESET };
            this.showPresetEditor = true;
        },
        
        savePreset() {
            const preset = this.editingPreset;
            if (!preset.name) { alert('预设名称不能为空'); return; }
            if (preset.id) {
                const idx = this.presets.findIndex(p => p.id === preset.id);
                this.$set(this.presets, idx, { ...preset });
            } else {
                preset.id = Date.now() + '' + Math.random().toString(36);
                this.presets.push({ ...preset });
            }
            this.savePresets();
            this.currentPresetId = preset.id;
            this.showPresetEditor = false;
        },
        
        deletePreset(id) {
            if (this.presets.length <= 1) { alert('至少保留一个预设'); return; }
            this.presets = this.presets.filter(p => p.id !== id);
            if (this.currentPresetId === id) this.currentPresetId = this.presets[0].id;
            this.savePresets();
            this.showPresetEditor = false;
        },
        
        applyPreset() {
            // 仅用于切换时的一些反馈
        },
        
        // ---------- AI 交互 ----------
        async sendMessage() {
            const content = this.inputMessage.trim();
            if (!content || this.isGenerating) return;
            if (!this.currentChar) { alert('请先选择一个角色'); return; }
            if (!this.apiConfig.key) { alert('请先在侧边栏配置 API Key'); return; }
            
            this.currentMessages.push({ role: 'user', content });
            this.inputMessage = '';
            this.$nextTick(() => this.scrollToBottom());
            this.saveCurrentChat();
            
            await this.callAI();
        },
        
        async callAI() {
            this.isGenerating = true;
            this.abortController = new AbortController();
            
            // 构建消息列表
            const systemPrompt = this.buildSystemPrompt();
            const messages = [
                { role: 'system', content: systemPrompt },
                ...this.currentMessages
            ];
            
            // 添加一条占位消息
            this.currentMessages.push({ role: 'assistant', content: '' });
            const assistantIdx = this.currentMessages.length - 1;
            
            try {
                const response = await fetch(`${this.apiConfig.baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiConfig.key}`
                    },
                    body: JSON.stringify({
                        model: this.apiConfig.model,
                        messages,
                        temperature: this.currentPreset.temperature,
                        max_tokens: this.currentPreset.maxTokens,
                        stream: true
                    }),
                    signal: this.abortController.signal
                });
                
                if (!response.ok) {
                    const err = await response.text();
                    throw new Error(`API错误 (${response.status}): ${err}`);
                }
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') continue;
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const json = JSON.parse(trimmed.slice(6));
                                const delta = json.choices[0]?.delta?.content;
                                if (delta) {
                                    this.currentMessages[assistantIdx].content += delta;
                                    this.$nextTick(() => this.scrollToBottom());
                                }
                            } catch(e) {}
                        }
                    }
                }
                
                // 后处理：应用正则替换
                this.applyRegexToLastMessage();
                
            } catch (e) {
                if (e.name === 'AbortError') {
                    this.currentMessages[assistantIdx].content += ' [已中止]';
                } else {
                    this.currentMessages[assistantIdx].content = `发生错误: ${e.message}`;
                }
            } finally {
                this.isGenerating = false;
                this.abortController = null;
                this.saveCurrentChat();
                this.$nextTick(() => this.scrollToBottom());
            }
        },
        
        buildSystemPrompt() {
            const char = this.currentChar;
            const preset = this.currentPreset;
            let prompt = char.description || `你是${char.name}。`;
            if (char.scenario) prompt += `\n场景: ${char.scenario}`;
            if (preset.systemPrompt) prompt += `\n${preset.systemPrompt}`;
            // 加入世界书相关信息 (简化处理，仅将关键词内容附加)
            if (char.worldBook && Object.keys(char.worldBook).length) {
                prompt += '\n相关知识:\n' + JSON.stringify(char.worldBook);
            }
            return prompt;
        },
        
        applyRegexToLastMessage() {
            const char = this.currentChar;
            if (!char.regexRules || !char.regexRules.length) return;
            const lastMsg = this.currentMessages[this.currentMessages.length-1];
            if (lastMsg.role !== 'assistant') return;
            for (let rule of char.regexRules) {
                try {
                    const regex = new RegExp(rule.pattern, 'g');
                    lastMsg.content = lastMsg.content.replace(regex, rule.replacement);
                } catch(e) {}
            }
        },
        
        stopGeneration() {
            if (this.abortController) {
                this.abortController.abort();
            }
        },
        
        async regenerateMessage(index) {
            // 删除该消息及之后的对话，重新生成
            if (this.currentMessages[index].role !== 'assistant') return;
            this.currentMessages = this.currentMessages.slice(0, index);
            this.saveCurrentChat();
            await this.callAI();
        },
        
        // ---------- AI 辅助功能 ----------
        async aiPolish(field) {
            const content = this.editingChar[field];
            if (!content) return;
            if (!this.apiConfig.key) { alert('请先配置 API Key'); return; }
            
            const prompt = `请对以下角色${field === 'description' ? '描述' : '开场白'}进行润色优化，使其更生动、符合角色设定，保持原意，直接返回优化后的文本，不要额外说明。\n原始文本：${content}`;
            const result = await this.simpleAIRequest(prompt);
            if (result) this.editingChar[field] = result;
        },
        
        async aiGenerateWorldBook() {
            const char = this.editingChar;
            if (!char.name) { alert('请先填写角色名'); return; }
            if (!this.apiConfig.key) { alert('请先配置 API Key'); return; }
            
            const prompt = `根据以下角色信息，生成一个世界书/知识库的 JSON 对象，包含5-8个关键词及其对应的背景知识。直接输出合法的 JSON 对象，不要其他内容。\n角色名：${char.name}\n描述：${char.description || '无'}\n场景：${char.scenario || '无'}`;
            const result = await this.simpleAIRequest(prompt);
            if (result) {
                try {
                    const obj = JSON.parse(result);
                    this.editingChar.worldBookStr = JSON.stringify(obj, null, 2);
                } catch(e) {
                    alert('AI 返回的不是有效 JSON，已填入原始返回内容');
                    this.editingChar.worldBookStr = result;
                }
            }
        },
        
        async aiGenerateRegex() {
            if (!this.apiConfig.key) { alert('请先配置 API Key'); return; }
            const prompt = `请生成3-5个常用的正则替换规则，用于角色扮演对话后处理，例如修正错误标点、移除多余空格、将特定词汇替换为另一种表达等。输出格式为 JSON 数组，每个元素包含 pattern 和 replacement 字段。直接输出 JSON 数组。`;
            const result = await this.simpleAIRequest(prompt);
            if (result) {
                try {
                    const arr = JSON.parse(result);
                    this.editingChar.regexStr = JSON.stringify(arr, null, 2);
                } catch(e) {
                    alert('AI 返回的不是有效 JSON');
                }
            }
        },
        
        async simpleAIRequest(prompt) {
            try {
                const resp = await fetch(`${this.apiConfig.baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiConfig.key}`
                    },
                    body: JSON.stringify({
                        model: this.apiConfig.model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.5
                    })
                });
                const data = await resp.json();
                return data.choices[0].message.content;
            } catch(e) {
                alert('AI 请求失败: ' + e.message);
                return null;
            }
        },
        
        // ---------- 工具方法 ----------
        clearChat() {
            if (!this.currentChar) return;
            if (!confirm('清空当前对话记录？')) return;
            this.currentMessages = this.currentChar.greeting ? 
                [{ role: 'assistant', content: this.currentChar.greeting }] : [];
            this.saveCurrentChat();
        },
        
        exportChat() {
            if (!this.currentChar) return;
            const text = this.currentMessages.map(m => `${m.role}: ${m.content}`).join('\n\n');
            const blob = new Blob([text], {type: 'text/plain'});
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `chat_${this.currentChar.name}_${Date.now()}.txt`;
            a.click();
        },
        
        copyMessage(content) {
            navigator.clipboard?.writeText(content);
            alert('已复制到剪贴板');
        },
        
        formatMessage(text) {
            return text.replace(/\n/g, '<br>');
        },
        
        scrollToBottom() {
            const el = this.$refs.chatMessages;
            if (el) el.scrollTop = el.scrollHeight;
        }
    },
    
    mounted() {
        this.loadFromStorage();
        // 如果无角色，不自动选中
        if (this.characters.length && !this.currentCharId) {
            this.currentCharId = this.characters[0].id;
            this.loadChatHistory(this.currentCharId);
        }
        
        // 自动调整textarea高度
        this.$watch('inputMessage', () => {
            this.$nextTick(() => {
                const ta = this.$refs.inputTextarea;
                if (ta) {
                    ta.style.height = 'auto';
                    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
                }
            });
        });
    }
});