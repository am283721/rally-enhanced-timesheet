Ext.define('TSTimesheet', {
  extend: 'Rally.app.App',
  componentCls: 'app',
  defaults: { margin: 10 },
  layout: 'border',

  items: [{ xtype: 'container', itemId: 'selector_box', region: 'north', layout: { type: 'hbox' }, minHeight: 25 }],

  pickableColumns: null,
  sortedColumn: null,
  direction: '',
  portfolioItemTypes: [],
  stateful: true,
  stateEvents: ['columnschosen', 'columnmoved', 'columnresize', 'sortchange'],
  stateId: 'CA.technicalservices.timesheet.Settings.4',

  config: {
    defaultSettings: {
      /* 0=sunday, 6=saturday */
      weekStartsOn: 0,
      showAddMyStoriesButton: false,
      showEditTimeDetailsMenuItem: false,
      showTaskStateFilter: false,
      timesheetSupportEmail: ''
    }
  },

  async launch() {
    try {
      this.currentUserTimeSheetAdmin = await TSUtilities.getCurrentUserIsTimeSheetAdmin();
      this.portfolioItemTypes = await TSUtilities.fetchPortfolioItemTypes();
      this._addSelectors(this.down('#selector_box'));
    } catch (e) {
      this.showError(e, 'Problem Initiating TimeSheet App');
    }
  },

  _getLowestLevelPIName: function () {
    return this.portfolioItemTypes[0].get('Name');
  },

  _addSelectors: function (container) {
    container.removeAll();
    container.add({ xtype: 'container', itemId: 'add_button_box' });

    const adminContainer = container.add({ xtype: 'container', flex: 1, layout: { type: 'hbox', align: 'middle', pack: 'center' } });
    let week_starts_on = this.getSetting('weekStartsOn');

    if (this.isTimeSheetAdmin()) {
      adminContainer.add({
        xtype: 'rallyusersearchcombobox',
        includeWorkspaceUsers: true,
        context: this.getContext(),
        fieldLabel: 'Select user',
        labelWidth: 65,
        width: 275,
        itemId: 'userCombo',
        id: 'userCombo',
        allowClear: true,
        allowNoEntry: false,
        margin: '0 10 0 10',
        listeners: {
          select() {
            this.updateData();
          },
          scope: this
        }
      });
    } else {
      adminContainer.add({
        xtype: 'container',
        itemId: 'messageContainer',
        tpl: '<tpl if="msg"><div>{msg}</div></tpl>'
      });
    }

    container
      .add({
        xtype: 'tsarroweddate',
        itemId: 'date_selector',
        fieldLabel: 'Week Starting',
        listeners: {
          scope: this,
          change: function (dp, new_value) {
            if (Ext.isEmpty(new_value)) {
              return;
            }

            let week_start = TSDateUtils.getBeginningOfWeekForLocalDate(new_value, week_starts_on);
            if (week_start !== new_value) {
              dp.setValue(week_start);
            }
            if (new_value.getDay() === week_starts_on) {
              this.updateData();
            }
          }
        }
      })
      .setValue(new Date());
  },

  _addAddButtons: function (container) {
    container.removeAll();

    container.add({
      xtype: 'rallybutton',
      text: 'Add My Tasks',
      toolTipText: '(in current iteration + defaults)',
      padding: 2,
      disabled: false,
      listeners: {
        scope: this,
        click: this._addCurrentTasksAndDefaults
      }
    });

    if (this.getSetting('showAddMyStoriesButton')) {
      container.add({
        xtype: 'rallybutton',
        text: 'Add My Stories',
        toolTipText: 'Add my stories and stories with my tasks',
        disabled: false,
        listeners: {
          scope: this,
          click: this._addCurrentStories
        }
      });
    }

    container.add({
      xtype: 'rallybutton',
      text: '+<span class="icon-task"> </span>',
      disabled: false,
      toolTipText: 'Search and add Tasks',
      listeners: {
        scope: this,
        click: this._findAndAddTask
      }
    });

    container.add({
      xtype: 'rallybutton',
      text: '+<span class="icon-story"> </span>',
      toolTipText: 'Search and add User Stories',
      disabled: false,
      listeners: {
        scope: this,
        click: this._findAndAddStory
      }
    });

    if (this.getSetting('showTaskStateFilter')) {
      container.add({
        xtype: 'rallyfieldvaluecombobox',
        model: 'Task',
        field: 'State',
        fieldLabel: 'State:',
        labelAlign: 'right',
        stateful: true,
        stateId: 'task-state-filter-combo',
        multiSelect: true,
        value: ['Defined', 'In-Progress', 'Completed'],
        listeners: {
          scope: this,
          change: this._filterState
        }
      });
    }
  },

  _filterState: function (stateChange) {
    let timetable = this.down('tstimetable');

    let stateFilter = new Ext.util.Filter({
      filterFn: function (item) {
        return Ext.Array.contains(stateChange.value, item.get('State')) || !item.get('State');
      }
    });

    if (stateChange.value.length > 0) {
      timetable.grid.filter(stateFilter);
    } else {
      timetable.grid.filter(null, true);
    }
  },

  // my workproducts are stories I own and stories that have tasks I own
  _addCurrentStories: function () {
    let timetable = this.down('tstimetable');

    if (!timetable) {
      return;
    }

    this.setLoading('Finding my current stories...');
    const currentUser = this.getCurrentUser();

    let my_filters = Rally.data.wsapi.Filter.or([
      { property: 'Owner.ObjectID', value: currentUser.ObjectID },
      { property: 'Tasks.Owner.ObjectID', value: currentUser.ObjectID }
    ]);

    let current_filters = Rally.data.wsapi.Filter.and([
      { property: 'Iteration.StartDate', operator: '<=', value: Rally.util.DateTime.toIsoString(this.startDate) },
      { property: 'Iteration.EndDate', operator: '>=', value: Rally.util.DateTime.toIsoString(this.startDate) },
      { property: 'Release.ReleaseDate', operator: '>=', value: Rally.util.DateTime.toIsoString(this.startDate) }
    ]);

    let config = {
      model: 'HierarchicalRequirement',
      context: {
        project: null
      },
      fetch: ['ObjectID', 'Name', 'FormattedID', 'WorkProduct', 'Project'],
      filters: current_filters.and(my_filters)
    };

    TSUtilities.loadWsapiRecords(config).then({
      scope: this,
      success: function (items) {
        let new_item_count = items.length;
        let current_count = timetable.getGrid().getStore().getTotalCount();

        if (current_count + new_item_count > this.getSetting('maxRows')) {
          Ext.Msg.alert('Problem Adding Items', 'Cannot add items to grid. Limit is ' + this.getSetting('maxRows') + ' lines in the time sheet.');
          this.setLoading(false);
        } else {
          Ext.Array.each(items, function (item) {
            timetable.addRowForItem(item);
          });
        }

        this.setLoading(false);
      },
      failure: function (msg) {
        Ext.Msg.alert('Problem with my stories', msg);
      }
    });
  },

  _addCurrentTasksAndDefaults: function () {
    let me = this;

    Deft.Chain.sequence([this._addCurrentTasks, this._addDefaults], this)
      .then({
        failure: function (msg) {
          Ext.Alert.msg('Problem adding current items', msg);
        }
      })
      .always(function () {
        me.setLoading(false);
      });
  },

  _addDefaults: function () {
    let timetable = this.down('tstimetable');
    let me = this;

    if (!timetable) {
      return;
    }

    let defaults = timetable.time_entry_defaults;
    let promises = [];

    this.setLoading('Finding my defaults...');

    Ext.Object.each(defaults, function (oid, type) {
      if (!type) {
        return;
      }

      promises.push(function () {
        let deferred = Ext.create('Deft.Deferred');

        let config = {
          model: type,
          context: {
            project: null
          },
          fetch: ['ObjectID', 'Name', 'FormattedID', 'WorkProduct', 'Project', 'Release', 'ReleaseDate'],
          filters: [{ property: 'ObjectID', value: oid }]
        };

        TSUtilities.loadWsapiRecords(config).then({
          scope: this,
          success: function (items) {
            let new_item_count = items.length;
            let current_count = timetable.getGrid().getStore().getTotalCount();

            if (current_count + new_item_count > me.getSetting('maxRows')) {
              Ext.Msg.alert('Problem Adding Items', 'Cannot add items to grid. Limit is ' + me.getSetting('maxRows') + ' lines in the time sheet.');
              me.setLoading(false);
            } else {
              Ext.Array.each(items, function (task) {
                timetable.addRowForItem(task);
              });
            }

            me.setLoading(false);
            deferred.resolve(items);
          },
          failure: function (msg) {
            deferred.reject(msg);
          }
        });

        return deferred.promise;
      });
    });

    return Deft.Chain.sequence(promises);
  },

  _addCurrentTasks: function () {
    let me = this;
    let deferred = Ext.create('Deft.Deferred');

    let timetable = this.down('tstimetable');
    if (!timetable) {
      return;
    }

    this.setLoading('Finding my current tasks...');

    let config = {
      model: 'Task',
      context: {
        project: null
      },
      fetch: ['ObjectID', 'Name', 'FormattedID', 'WorkProduct', 'Project'],
      filters: [
        { property: 'Owner.ObjectID', value: this.getCurrentUser().ObjectID },
        { property: 'Iteration.StartDate', operator: '<=', value: Rally.util.DateTime.toIsoString(this.startDate) },
        { property: 'Iteration.EndDate', operator: '>=', value: Rally.util.DateTime.toIsoString(this.startDate) },
        { property: 'Release.ReleaseDate', operator: '>=', value: Rally.util.DateTime.toIsoString(this.startDate) },
        { property: 'State', operator: '!=', value: 'Completed' }
      ]
    };

    TSUtilities.loadWsapiRecords(config).then({
      scope: this,
      success: function (tasks) {
        let new_item_count = tasks.length;
        let current_count = timetable.getGrid().getStore().getTotalCount();

        if (current_count + new_item_count > me.getSetting('maxRows')) {
          Ext.Msg.alert('Problem Adding Items', 'Cannot add items to grid. Limit is ' + me.getSetting('maxRows') + ' lines in the time sheet.');
          this.setLoading(false);
        } else {
          Ext.Array.each(tasks, function (task) {
            timetable.addRowForItem(task);
          });
        }

        this.setLoading(false);
        deferred.resolve(tasks);
      },
      failure: function (msg) {
        deferred.reject(msg);
      }
    });

    return deferred.promise;
  },

  _findAndAddTask: function () {
    let me = this;
    let timetable = this.down('tstimetable');
    let filters = [{ property: 'State', operator: '!=', value: 'Completed' }];
    let fetch_fields = ['WorkProduct', 'Feature', 'Release', 'ReleaseDate', 'Project', 'Name', 'FormattedID', 'ObjectID'];
    let title = 'Choose Task(s)';

    if (timetable) {
      Ext.create('Rally.technicalservices.ChooserDialog', {
        artifactTypes: ['task'],
        autoShow: true,
        multiple: true,
        width: 1500,
        title,
        context: {
          project: null
        },
        storeConfig: {
          filters: filters
        },
        filterableFields: [
          {
            displayName: 'Formatted ID',
            attributeName: 'FormattedID'
          },
          {
            displayName: 'Name',
            attributeName: 'Name'
          },
          {
            displayName: 'WorkProduct',
            attributeName: 'WorkProduct.Name'
          },
          {
            displayName: 'Project',
            attributeName: 'Project.Name'
          },
          {
            displayName: 'Owner',
            attributeName: 'Owner'
          },
          {
            displayName: 'State',
            attributeName: 'State'
          }
        ],
        columns: [
          {
            text: 'ID',
            dataIndex: 'FormattedID'
          },
          'Name',
          'WorkProduct',
          'Iteration',
          'Release',
          'Project',
          'Owner',
          'State'
        ],
        fetchFields: fetch_fields,
        listeners: {
          artifactchosen: function (dialog, selectedRecords) {
            if (!Ext.isArray(selectedRecords)) {
              selectedRecords = [selectedRecords];
            }

            let new_item_count = selectedRecords.length;
            let current_count = timetable.getGrid().getStore().getTotalCount();

            if (current_count + new_item_count > me.getSetting('maxRows')) {
              Ext.Msg.alert('Problem Adding Tasks', 'Cannot add items to grid. Limit is ' + me.getSetting('maxRows') + ' lines in the time sheet.');
            } else {
              Ext.Array.each(selectedRecords, function (selectedRecord) {
                timetable.addRowForItem(selectedRecord);
              });
            }
          },
          scope: this
        }
      });
    }
  },

  _findAndAddStory: function () {
    let me = this;
    let title = 'Choose Work Product(s)';
    let timetable = this.down('tstimetable');
    let filters = Ext.create('Rally.data.QueryFilter', { property: 'ScheduleState', operator: '=', value: 'Requested' });
    filters = filters.or({ property: 'ScheduleState', operator: '=', value: 'Defined' });
    filters = filters.or({ property: 'ScheduleState', operator: '=', value: 'In-Progress' });
    filters = filters.and({ property: 'DirectChildrenCount', operator: '=', value: 0 });

    if (timetable) {
      Ext.create('Rally.technicalservices.ChooserDialog', {
        artifactTypes: ['hierarchicalrequirement', 'defect'],
        autoShow: true,
        title,
        multiple: true,
        width: 1500,
        storeConfig: {
          filters: filters
        },
        filterableFields: [
          {
            displayName: 'Formatted ID',
            attributeName: 'FormattedID'
          },
          {
            displayName: 'Name',
            attributeName: 'Name'
          },
          {
            displayName: 'Project',
            attributeName: 'Project.Name'
          },
          {
            displayName: 'Owner',
            attributeName: 'Owner'
          }
        ],
        columns: [
          {
            text: 'ID',
            dataIndex: 'FormattedID'
          },
          'Name',
          'Release',
          'Iteration',
          'Project',
          'Owner',
          'ScheduleState'
        ],

        fetchFields: ['WorkProduct', 'Feature', 'Project', 'Name', 'FormattedID', 'ObjectID', 'Release', 'ReleaseDate'],

        listeners: {
          artifactchosen: function (dialog, selectedRecords) {
            if (!Ext.isArray(selectedRecords)) {
              selectedRecords = [selectedRecords];
            }

            let new_item_count = selectedRecords.length;
            let current_count = timetable.getGrid().getStore().getTotalCount();

            if (current_count + new_item_count > me.getSetting('maxRows')) {
              Ext.Msg.alert('Problem Adding Stories', 'Cannot add items to grid. Limit is ' + me.getSetting('maxRows') + ' lines in the time sheet.');
            } else {
              Ext.Array.each(selectedRecords, function (selectedRecord) {
                timetable.addRowForItem(selectedRecord);
              });
            }
          },
          scope: this
        }
      });
    }
  },

  updateData: function () {
    if (!this.down('#date_selector')) {
      return;
    }

    let timesheetUser = this.getCurrentUser();
    let timetable = this.down('tstimetable');
    this.startDate = this.down('#date_selector').getValue();
    const isPastTimeSheet = new Date() > Rally.util.DateTime.add(this.startDate, 'week', 1);
    const editable = !isPastTimeSheet || this.isTimeSheetAdmin();
    const isAdminUpdatingOtherUser = this.isTimeSheetAdmin() && timesheetUser && timesheetUser._ref !== this.getContext().getUser()._ref;
    const messageContainer = this.down('#messageContainer');

    if (!Ext.isEmpty(timetable)) {
      timetable.destroy();
    }

    if (messageContainer) {
      if (editable) {
        messageContainer.update({ msg: '' });
      } else {
        let msg = 'The selected timesheet is in the past and hours cannot be updated';

        if (this.getSetting('timesheetSupportEmail')) {
          msg += `. For timesheet adjustments, please contact ${this.getSetting('timesheetSupportEmail')}`;
        }

        messageContainer.update({ msg });
      }
    }

    if (isAdminUpdatingOtherUser) {
      this.down('#add_button_box').hide();
    } else {
      this.down('#add_button_box').show();
    }

    this.time_table = this.add({
      xtype: 'tstimetable',
      region: 'center',
      layout: 'fit',
      margin: 15,
      timesheetUser,
      pickableColumns: this.pickableColumns,
      sortedColumn: this.sortedColumn,
      sortDirection: this.sortDirection,
      lowestLevelPIName: this._getLowestLevelPIName(),
      startDate: this.startDate,
      editable,
      maxRows: this.getSetting('maxRows'),
      showEditTimeDetailsMenuItem: false,
      listeners: {
        scope: this,
        gridReady: function () {
          this._addAddButtons(this.down('#add_button_box'));
        },
        sortchange: function (grid, dataIndex, direction) {
          this.sortedColumn = dataIndex;
          this.sortDirection = direction;
          this.fireEvent('sortchange', this, dataIndex, direction);
        }
      }
    });
  },

  isTimeSheetAdmin() {
    return this.currentUserTimeSheetAdmin;
  },

  getSettingsFields: function () {
    let check_box_margins = '5 0 5 0';
    const config = { labelWidth: 175, width: 350 };

    let days_of_week = [
      { Name: 'Sunday', Value: 0 },
      { Name: 'Monday', Value: 1 },
      { Name: 'Tuesday', Value: 2 },
      { Name: 'Wednesday', Value: 3 },
      { Name: 'Thursday', Value: 4 },
      { Name: 'Friday', Value: 5 },
      { Name: 'Saturday', Value: 6 }
    ];

    return [
      {
        ...config,
        name: 'weekStartsOn',
        xtype: 'rallycombobox',
        fieldLabel: 'Week Starts On',
        labelAlign: 'left',
        displayField: 'Name',
        valueField: 'Value',
        value: this.getSetting('weekStartsOn'),
        store: Ext.create('Rally.data.custom.Store', {
          data: days_of_week
        }),

        readyEvent: 'ready'
      },
      {
        ...config,
        xtype: 'rallynumberfield',
        name: 'maxRows',
        labelAlign: 'left',
        maxValue: 1000,
        minValue: 10,
        fieldLabel: 'Maximum number of rows',
        value: this.getSetting('maxRows') || 100
      },
      {
        ...config,
        xtype: 'rallytextfield',
        name: 'timesheetSupportEmail',
        fieldLabel: 'Timesheet Support Email'
      },
      {
        name: 'showTaskStateFilter',
        xtype: 'rallycheckboxfield',
        boxLabelAlign: 'after',
        fieldLabel: '',
        margin: check_box_margins,
        boxLabel: 'Show the Task State Filter<br/><span style="color:#999999;"><i>User can limit display of tasks to ones in particular states (does not affect other object types).</i></span>'
      },
      {
        name: 'showAddMyStoriesButton',
        xtype: 'rallycheckboxfield',
        boxLabelAlign: 'after',
        fieldLabel: '',
        margin: check_box_margins,
        boxLabel:
          'Show the Add My Stories Button<br/><span style="color:#999999;"><i>User can add stories in a current sprint that they own or that have tasks they own (does not look for default items).</i></span>'
      }
    ];
  },

  getCurrentUser() {
    let selectedUser = this.down('#userCombo') && this.down('#userCombo').getRecord();

    if (selectedUser && selectedUser.get('ObjectID')) {
      return selectedUser.getData();
    }

    return this.getContext().getUser();
  },

  getState: function () {
    return {
      pickableColumns: this.pickableColumns,
      sortedColumn: this.sortedColumn,
      sortDirection: this.sortDirection
    };
  },

  isExternal: function () {
    return typeof this.getAppId() == 'undefined';
  },

  onSettingsUpdate: function () {
    this.launch();
  },

  showError(msg, defaultMessage) {
    console.error(msg);
    Rally.ui.notify.Notifier.showError({ message: this.parseError(msg, defaultMessage) });
  },

  parseError(e, defaultMessage) {
    defaultMessage = defaultMessage || 'An unknown error has occurred';

    if (typeof e === 'string' && e.length) {
      return e;
    }
    if (e.message && e.message.length) {
      return e.message;
    }
    if (e.exception && e.error && e.error.errors && e.error.errors.length) {
      if (e.error.errors[0].length) {
        return e.error.errors[0];
      }
      if (e.error && e.error.response && e.error.response.status) {
        return `${defaultMessage} (Status ${e.error.response.status})`;
      }
    }
    if (e.exceptions && e.exceptions.length && e.exceptions[0].error) {
      return e.exceptions[0].error.statusText;
    }
    if (e.exception && e.error && typeof e.error.statusText === 'string' && !e.error.statusText.length && e.error.status && e.error.status === 524) {
      return 'The server request has timed out';
    }
    return defaultMessage;
  }
});
