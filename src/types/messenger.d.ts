// Thunderbird MailExtension API 的最小类型声明，补 firefox-webext-browser 缺的部分。

declare namespace browser {
  namespace accounts {
    type Identity = {
      id: string;
      email: string;
      name: string;
    };
    type Folder = {
      id?: string;
      name: string;
      type?: string;
      subFolders?: Folder[];
    };
    type MailAccount = {
      id: string;
      name: string;
      type: string;
      identities?: Identity[];
      folders?: Folder[];
    };
    function list(): Promise<MailAccount[]>;
  }

  namespace addressBooks {
    type AddressBook = { id: string; name: string };
    function list(complete?: boolean): Promise<AddressBook[]>;
  }

  namespace contacts {
    type Contact = {
      id: string;
      type: string;
      properties: Record<string, string | undefined>;
    };
    function list(parentId: string): Promise<Contact[]>;
  }

  namespace messages {
    type MessageHeader = {
      id: number;
      date: number | string;
      subject: string;
      author: string;
      recipients?: string[];
      ccList?: string[];
      bccList?: string[];
      headerMessageId?: string;
      flagged?: boolean;
      junk?: boolean;
      read?: boolean;
      tags?: string[];
    };
    type MessageList = {
      id: string | null;
      messages: MessageHeader[];
    };
    type MessagePart = {
      contentType?: string;
      headers?: Record<string, string[]>;
      body?: string;
      parts?: MessagePart[];
    };
    function list(folderId: string | accounts.Folder): Promise<MessageList>;
    function continueList(listId: string): Promise<MessageList>;
    function getFull(messageId: number): Promise<MessagePart>;
    function get(messageId: number): Promise<MessageHeader>;
    function update(
      messageId: number,
      patch: { read?: boolean; flagged?: boolean; junk?: boolean; tags?: string[] },
    ): Promise<void>;
    function archive(messageIds: number[]): Promise<void>;
  }

  namespace mailTabs {
    type MailTab = { id: number; active: boolean };
    function query(filter?: { active?: boolean }): Promise<MailTab[]>;
    function setSelectedMessages(tabId: number, messageIds: number[]): Promise<void>;
  }

  namespace messageDisplay {
    function open(props: { messageId: number }): Promise<unknown>;
  }

  // browser.calendar 在 TB 140 ESR 仍部分实验性，运行时按 typeof === 'function' 检测
  namespace calendar {
    namespace calendars {
      type Calendar = {
        id: string;
        name: string;
        type: string;
        readOnly: boolean;
        color?: string;
      };
      function query(filter?: { type?: string; readOnly?: boolean }): Promise<Calendar[]>;
    }
    namespace items {
      type CalendarItem = {
        id: string;
        type: 'event' | 'task';
        title: string;
        startDate?: string;
        endDate?: string;
        dueDate?: string;
        description?: string;
        location?: string;
      };
      function create(
        calendarId: string,
        item: Partial<CalendarItem>,
      ): Promise<CalendarItem>;
    }
  }

  namespace downloads {
    function download(opts: {
      url: string;
      filename?: string;
      saveAs?: boolean;
    }): Promise<number>;
  }

  namespace compose {
    type ReplyType = 'replyToSender' | 'replyToAll' | 'replyToList';
    type ComposeDetails = {
      to?: string | string[];
      cc?: string | string[];
      bcc?: string | string[];
      subject?: string;
      body?: string;
      plainTextBody?: string;
      isPlainText?: boolean;
    };
    function beginNew(details?: ComposeDetails): Promise<unknown>;
    function beginReply(
      messageId: number,
      replyType?: ReplyType,
      details?: ComposeDetails,
    ): Promise<unknown>;
  }
}

declare const messenger: typeof browser;
