// チャットワークにメッセージを投稿
function postMessage(roomid, body) {
  // チャットワークアクセス用情報
  const CW_API = {
    ep: "https://api.chatwork.com/v2/",
    token: "<CHATWORK_TOKEN>"
  }

  const options = {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { "X-ChatWorkToken": CW_API.token },
    payload: { body: body },
    muteHttpExceptions : true
  };

  const url = CW_API.ep + `rooms/${roomid}/messages`;

  console.log("request..." + url);
  return UrlFetchApp.fetch(url, options);
}

function doMMApi(resource, options) {
  // マインドマイスターアクセス用情報
  const MM_API = {
    ep: "https://www.mindmeister.com/api/v2/",
    token: '<MINDMEISTER_TOKEN>'
  }

  // mindmeisterのAPI呼び出し
  const url = MM_API.ep + resource;
  options.headers = { "Authorization": 'Bearer ' + MM_API.token };
  options.muteHttpExceptions = true;

  console.log("request..." + url);
  return UrlFetchApp.fetch(url, options);

}

// マップをファイル変換して取得
function getMap(id, ext) {
  return doMMApi(`maps/${id}.${ext}`, {});
}

// マップ名を取得
function getMapName(id) {
  const resp = doMMApi(`maps/${id}`, {contentType: 'application/json'});
  if(resp.getResponseCode() == 200) {
    return JSON.parse(resp.getContentText()).title;
  }
  return "<NO_NAME>";
}

// マップ内の外部リンク一覧を取得
function countURL(id) {
  const rtn = {};

  // マインドマップを取得
  const resp = getMap(id, 'rtf');

  if(resp.getResponseCode() == 200) {
    const mm_name = getMapName(id);

    // プレーンテキスト
    const plaintxt = resp.getBlob().getDataAsString();
    console.log(plaintxt);

    const match = plaintxt.matchAll(/HYPERLINK "(.+)"/g);

    rtn.success = true;
    rtn.mm_name = mm_name;
    rtn.urls = Array.from( new Set([...match].map(e => e[1])) );
  }
  else {
    console.log("error..." + resp.getResponseCode());
    rtn.success = false;
    putJsonObj(resp.getAllHeaders(), "error_response");
  }
  rtn.code = resp.getResponseCode();

  return rtn;
}

// 自分宛てのメッセージか判定
function isMentionToMe(body) {
  return (body.match(/^\[To:<ACCOUNT_ID>/) || body.match(/^\[rp aid=<ACCOUNT_ID>/));
}

// Youtubeの動画IDを取得
function getYoutubeVideoId(url) {
  // 短縮URLに対応
  const match = url
    .replace('youtu.be/', 'www.youtube.com/watch?v=')
    .matchAll(/https:\/\/www.youtube.com\/watch\?v\=([^?]+)/g);

  return Array.from( new Set([...match].map(e => e[1])) )[0];
}

// 動画のVideosリソースを取得
function getYoutubeResource(id) {
  return YouTube
    .Videos
    .list('id,snippet', { id: id, })
    .items[0];
}

// マインドマップのURLを抽出
function collectMindMaps(body) {
  // 短縮URLに対応
  const match = body
    .replace('mm.tt', 'www.mindmeister.com')
    .matchAll(/https:\/\/www.mindmeister.com\/(\d+)/g);

  // 重複を排除
  return Array.from( new Set([...match].map(e => e[1])) );
}

// JSON形式のオブジェクトをGoogleドキュメントに出力
function putJsonObj(e, title) {
  const FOLDER_ID = '<GOOGLE_DRV_FOLDER_ID>';
  const options = {
    title: title,
    mimeType: MimeType.GOOGLE_DOCS,
    parents: [{ id: FOLDER_ID }]
  };

  // 指定したフォルダにファイルを作成
  Drive.Files.insert(options, Utilities.newBlob(JSON.stringify(e), MimeType.PLAIN_TEXT));
}

// POSTされたデータのコンテンツを取得
function getContents(e) {
  if(e.postData.type == 'application/json') {
    return JSON.parse(e.postData.contents);
  }
  return e.parameter;
}

// 返信用の文字列を生成する
function generateRespString(ev, mindmaps) {
  const MAX_PROC_NUM = 1;
  let cnt = 0;
  let str = `[rp aid=${ev.account_id} to=${ev.room_id}-${ev.message_id}]`;

  // マインドマップのURLがある場合
  for(mm_id of mindmaps) {
    if(cnt < MAX_PROC_NUM) {
      // マップ情報を取得
      const resp = countURL(mm_id);
      str += `\n`;

      if(resp.success) {
        str += `[info][title]${resp.mm_name}[\/title]`;
        str += `(F) 外部リンク一覧\n[code]`;

        // 外部リンクのリスト文字列を生成
        for(url of resp.urls) {
          // YouTubeのURLの場合
          if(video_id = getYoutubeVideoId(url)) {
            // 動画リソース情報を取得
            if(res = getYoutubeResource(video_id)) {
              str += `■ ${res.snippet.title}\n`;
            }
            else {
              str += `■ 不明なYoutube動画です。。。(^^;)\n`;
            }
          }
          str += `${url}\n`;
        }
        str += `[\/code][\/info]`;
      }
      else {
        str += `[info][title]${resp.code}：マップ情報取得エラー[\/title]`;
        str += `以下のマップの情報を取得できませんでした。。。(whew)\n`;
        str += `https://www.mindmeister.com/${mm_id}\n[\/info]`;
      }
    }
    else {
      if(cnt == MAX_PROC_NUM) {
        str += `以下のマップは、ガスゴリくんの同時処理能力を超えてしまいました。。。(whew)\n`;
      }
      str += `https://www.mindmeister.com/${mm_id}\n`;
    }

    cnt++;
  }

  return str;
}

// APIコール時の処理
function doPost(e) {
  const ev = getContents(e).webhook_event;
  let rtn = ev.body;

  // デバッグ用にログを取る
  //putJsonObj(e);

  // メンションが付いている場合
  if(isMentionToMe(ev.body)) {
    const mindmaps = collectMindMaps(ev.body);

    if(mindmaps.length > 0) {
      // 返信用の文字列を生成
      const str = generateRespString(ev, mindmaps);
      postMessage(ev.room_id, str);
      rtn = str;
    }
  }

  return ContentService.createTextOutput(rtn);
}

// テスト用の処理
function doTest() {
  const MAP_ID = {
    test_for_api: "<MINDMAP_ID>",
  };

  const obj = {
    webhook_setting_id: -1,
    webhook_event_type: "message_created",
    webhook_event: {
      body: "[To:<TO_ACCOUNT_ID>]",
      room_id: "<ROOM_ID>",
      account_id: "<FROM_ACCOUNT_ID>",
      message_id: "<MESSAGE_ID>",
      send_time: -1,
      update_time: -1
    }
  };

  obj.webhook_event.body += "\nhttps://www.mindmeister.com/" + MAP_ID.test_for_api;

  const e = {
    parameter: {
      id: MAP_ID.test_for_api
    },
    postData: {
      name: 'postData',
      type: 'application/json',
      contents: JSON.stringify(obj)
    }
  };

  const resp = doPost(e);
  console.log(resp.getContent());
}

