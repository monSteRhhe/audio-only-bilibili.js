// ==UserScript==
// @name         Audio-Only-Bilibili
// @namespace    http://tampermonkey.net/
// @version      1.0.2
// @description  B站视频页使用仅音频模式进行播放
// @author       monSteRhhe
// @match        https://www.bilibili.com/video/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        window.onurlchange
// @require      https://unpkg.com/ajax-hook/dist/ajaxhook.min.js
// @run-at       document-end
// @connect      api.bilibili.com
// ==/UserScript==
/* globals ah, waitForKeyElements */

(function() {
    'use strict';

    /* 直接运行自启动函数获取音频地址的Promise */
    let audio_promise = (async () => {
        let _url_info = getURLinfo(),
            _cid = await getCid(_url_info.bvid, _url_info.page),
            _audio_src = await getAudioSrc(_url_info.bvid, _cid, 16);
        return _audio_src
    })();

    let Flag = false; // 用于判断音频模式是否开启

    /* 点击菜单按钮触发 */
    GM_registerMenuCommand('音频模式', () => {
        clickMenuStart();
    })

    /* url改变(切换分P)时触发 */
    if (window.onurlchange === null) {
        window.addEventListener('urlchange', () => {
            if (Flag) {
                applyNewVideoAttr();
            }
        });
    }

    /* 检测快照刷新后自启动 */
    if (GM_getValue('autorun', false)) {
        GM_deleteValue('autorun');
        clickMenuStart();
    }

    /**
     * 菜单点击启动
     */
    async function clickMenuStart() {
        let video_prefetch = document.querySelector('div.bpx-player-video-perch'),
            audio_alert = video_prefetch.querySelector('div.audio_only_div'),
            preview_box = document.querySelector('img.bpx-player-progress-preview-image');

        // 判断是否开启音频模式
        if (audio_alert == null) {
            rejectVideoShot();

            Flag = true;

            // 检测到有加载快照就刷新
            if (preview_box != null && preview_box.src != '') {
                GM_setValue('autorun', true);
                location.reload(); // 刷新页面
                return;
            }

            // 添加样式
            GM_addStyle(`
                .audio_only_div {
                    color: #fff;
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    top: 20px;
                    font-size: 18px;
                    width: 200px;
                    box-sizing: border-box;
                    z-index: 50;
                    padding: 10px;
                    border-bottom: 1px solid gray;
                    user-select: none;
                }
                .alert_text {
                    position: relative;
                    top: 10%;
                    text-align: center;
                    white-space: break-spaces;
                }
                .small {
                    text-align: center;
                    margin-top: 8px;
                    font-size: 12px;
                    color: #eee;
                }
            `);

            // 添加音频模式的显示文字
            let audio_alert_box = document.createElement('div');
            audio_alert_box.className = 'audio_only_div';
            audio_alert_box.innerHTML = '<p class="alert_text">音频模式<br><div class="small">点击脚本菜单切换模式</div></p>';
            video_prefetch.appendChild(audio_alert_box);

            await applyNewVideoAttr();
        } else {
            location.reload();
        }
    }

    /**
     * 设置video标签属性
     */
    async function applyNewVideoAttr() {
        // 删除img标签
        let preview_box = document.querySelector('img.bpx-player-progress-preview-image');
        if (preview_box != null) {
            preview_box.parentNode.removeChild(preview_box);
        }

        let video_prefetch = document.querySelector('div.bpx-player-video-perch'),
            video_wrap = video_prefetch.querySelector('div.bpx-player-video-wrap'),
            video = video_wrap.querySelector('video'),
            meta = document.getElementsByTagName('meta'),
            bg_url = '';

        // 获取略缩图url用作背景
        for (let meta_tag of meta) {
            if (meta_tag.getAttribute('itemprop') == 'image') {
                bg_url = meta_tag.getAttribute('content');
                break;
            }
        }

        let bg_style = 'background: url("' + bg_url + '") center center / cover no-repeat transparent; opacity: 0.3;';
        video.style = bg_style;

        audio_promise.then(value => {
            video.src = value;
        })
    }

    /**
     * 获取URL中的BV号与分P信息
     * @returns 返回BV号与分P的对象
     */
    function getURLinfo() {
        let bvid = '',
            page = null;

        // BV号
        for (let i of location.pathname.split('/')) {
            if (i.indexOf('BV') != -1) {
                bvid = i;
            }
        }
        // 判断是否有多个分p以及分P数
        if (location.search.indexOf('?') != -1) {
            let params = location.search.substr(1).split('&');
            for (let j of params) {
                if (j.split('=')[0] == 'p') {
                    page = j.split('=')[1];
                    break;
                }
            }
        }

        return {
            bvid: bvid,
            page: page
        };
    }

    /**
     * 获取cid
     * @param {string} bvid BV号
     * @param {number} page 分P数
     * @returns 返回cid的值
     */
    function getCid(bvid, page) {
        return new Promise(async (resolve, reject) => {
            let cid = '';
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
                responseType: 'json',
                onload: (response) => {
                    if (response.response.code == 0) {
                        if (page == null) {
                            cid = response.response.data.cid;
                        } else {
                            cid = response.response.data.pages[page - 1].cid;
                        }
                        resolve(cid);
                    }
                }
            });
        })
    }

    /**
     * DASH方式获取音频流地址
     * @param {string} bvid BV号
     * @param {number} cid cid值
     * @param {number} fnval 视频流格式标识
     * @returns 返回仅音频流的地址
     */
    function getAudioSrc(bvid, cid, fnval) {
        return new Promise(async (resolve, reject) => {
            let src = '';
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.bilibili.com/x/player/wbi/playurl?bvid=${bvid}&cid=${cid}&fnval=${fnval}`,
                responseType: 'json',
                onload: (response) => {
                    if (response.response.code == 0) {
                        src = response.response.data.dash.audio[0].baseUrl;
                        resolve(src);
                    }
                }
            });
        })
    }

    /**
     * 阻止加载视频进度条快照
     */
    function rejectVideoShot() {
        ah.proxy({
            onRequest: async (config, handler) => {
                if (config.url.indexOf('api.bilibili.com/x/player/videoshot') != -1) {
                    handler.reject({
                        config: config,
                        type: 'error'
                    })
                } else {
                    handler.next(config);
                }
            }
        }, unsafeWindow)
    }
})();
