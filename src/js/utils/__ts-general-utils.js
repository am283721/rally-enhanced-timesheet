Ext.define('TSUtilities', {
  singleton: true,

  timeLockKeyPrefix: 'rally.technicalservices.timesheet.weeklock',
  approvalKeyPrefix: 'rally.technicalservices.timesheet.status',
  deletionKeyPrefix: 'rally.technicalservices.timesheet.deletion',
  pinKeyPrefix: 'rally.technicalservices.timesheet.pin',

  archiveSuffix: '~archived',

  loadWsapiRecords: function (config, returnOperation) {
    let deferred = Ext.create('Deft.Deferred');

    let default_config = {
      model: 'Defect',
      fetch: ['ObjectID']
    };

    Ext.create('Rally.data.wsapi.Store', Ext.Object.merge(default_config, config)).load({
      callback: function (records, operation, successful) {
        if (successful) {
          if (returnOperation) {
            deferred.resolve(operation);
          } else {
            deferred.resolve(records);
          }
        } else {
          deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
        }
      }
    });
    return deferred.promise;
  },

  loadWsapiRecordsAsync(config, returnOperation) {
    return this.wrap(this.loadWsapiRecords(config, returnOperation));
  },

  loadWsapiRecordsWithParallelPages: function (config, msg) {
    let deferred = Ext.create('Deft.Deferred'),
      me = this;

    let count_check_config = Ext.clone(config);
    count_check_config.limit = 1;
    count_check_config.pageSize = 1;
    count_check_config.fetch = ['ObjectID'];

    this.loadWsapiRecords(count_check_config, true).then({
      success: function (operation) {
        config.pageSize = 200;
        config.limit = config.pageSize;
        let total = operation.resultSet.totalRecords;
        let page_count = Math.ceil(total / config.pageSize);

        let promises = [];
        Ext.Array.each(_.range(1, page_count + 1), function (page_index) {
          let config_clone = Ext.clone(config);
          config_clone.currentPage = page_index;
          promises.push(function () {
            let percentage = parseInt((page_index * 100) / page_count, 10);
            let message = msg || 'Loading values';
            Rally.getApp().setLoading(message + ' (' + percentage + '%)');
            return me.loadWsapiRecords(config_clone);
          });
        });
        CA.techservices.promise.ParallelThrottle.throttle(promises, 6, me).then({
          success: function (results) {
            deferred.resolve(Ext.Array.flatten(results));
          },
          failure: function (msg) {
            deferred.reject(msg);
          }
        });
      },
      failure: function (msg) {
        deferred.reject(msg);
      }
    });
    return deferred.promise;
  },

  getPreferenceProject: function () {
    return Rally.getApp().getSetting('preferenceProjectRef');
  },

  isEditableProjectForCurrentUser: function (projectRef, scope) {
    let app = scope || Rally.getApp(),
      me = this;

    if (this.currentUserIsAdmin(scope)) {
      return true;
    }

    let project_oid = this._getOidFromRef(projectRef);
    let editor_permissions = Ext.Array.filter(app.getContext().getPermissions().userPermissions, function (permission) {
      if (permission.Role != 'Editor' && permission.Role != 'ProjectAdmin') {
        return false;
      }

      return me._getOidFromRef(permission._ref) == project_oid;
    });

    return editor_permissions.length > 0;
  },

  getEditableProjectForCurrentUser: function () {
    let app = Rally.getApp();
    if (this._currentUserCanWrite()) {
      return app.getContext().getProjectRef();
    }

    let workspace_oid = this._getOidFromRef(app.getContext().getWorkspaceRef());

    let editor_permissions = Ext.Array.filter(
      app.getContext().getPermissions().userPermissions,
      function (permission) {
        if (Ext.isEmpty(permission.Workspace)) {
          return false;
        }
        let permission_oid = this._getOidFromRef(permission.Workspace);

        if (workspace_oid != permission_oid) {
          return false;
        }

        return permission.Role == 'Editor' || permission.Role == 'ProjectAdmin';
      },
      this
    );

    if (editor_permissions.length > 0) {
      return editor_permissions[0]._ref;
    }
    return false;
  },

  _getOidFromRef: function (ref) {
    let ref_array = ref.replace(/\.js$/, '').split(/\//);
    return ref_array[ref_array.length - 1].replace(/\.js/, '');
  },

  // true if sub or workspace admin
  currentUserIsAdmin: function (scope) {
    let app = scope || Rally.getApp();

    if (this.currentUserIsSubAdmin()) {
      return true;
    }

    let permissions = app.getContext().getPermissions().userPermissions;

    let workspace_admin_list = Ext.Array.filter(permissions, function (p) {
      return p.Role == 'Workspace Admin' || p.Role == 'Subscription Admin';
    });

    let current_workspace_ref = app.getContext().getWorkspace()._ref;
    let is_workspace_admin = false;

    if (workspace_admin_list.length > 0) {
      Ext.Array.each(workspace_admin_list, function (p) {
        if (current_workspace_ref.replace(/\.js$/, '') == p._ref.replace(/\.js$/, '')) {
          is_workspace_admin = true;
        }
      });
    }

    return is_workspace_admin;
  },

  currentUserIsSubAdmin: function (scope) {
    let app = scope || Rally.getApp();

    let permissions = app.getContext().getPermissions().userPermissions;

    let sub_admin_list = Ext.Array.filter(permissions, function (p) {
      return p.Role == 'Subscription Admin';
    });

    return sub_admin_list.length > 0;
  },

  _currentUserCanWrite: function () {
    let app = Rally.getApp();

    if (app.getContext().getUser().SubscriptionAdmin) {
      return true;
    }

    let permissions = app.getContext().getPermissions().userPermissions;

    let workspace_admin_list = Ext.Array.filter(permissions, function (p) {
      return p.Role == 'Workspace Admin' || p.Role == 'Subscription Admin';
    });

    let current_workspace_ref = app.getContext().getWorkspace()._ref;
    let can_unlock = false;

    if (workspace_admin_list.length > 0) {
      Ext.Array.each(workspace_admin_list, function (p) {
        if (current_workspace_ref.replace(/\.js$/, '') == p._ref.replace(/\.js$/, '')) {
          can_unlock = true;
        }
      });
    }

    return can_unlock;
  },

  _currentUserCanUnapprove: function () {
    return this.currentUserIsAdmin();
  },

  async getCurrentUserIsTimeSheetAdmin() {
    const users = await this.wrap(Ext.create(Rally.data.wsapi.RefsToRecords).convert([Rally.getApp().getContext().getUser()._ref])).catch(() => null);

    if (users && users.length) {
      return !!users[0].get('c_TimesheetAdmin');
    }

    return false;
  },

  fetchPortfolioItemTypes() {
    let config = {
      model: 'TypeDefinition',
      fetch: ['TypePath', 'Ordinal', 'Name'],
      filters: [{ property: 'TypePath', operator: 'contains', value: 'PortfolioItem/' }],
      sorters: [{ property: 'Ordinal', direction: 'ASC' }]
    };

    return this.loadWsapiRecordsAsync(config);
  },

  fetchField: function (modelName, fieldName) {
    let deferred = Ext.create('Deft.Deferred');
    Rally.data.ModelFactory.getModel({
      type: modelName,
      success: function (model) {
        deferred.resolve(model.getField(fieldName));
      },
      failure: function () {
        let error = 'Could not load schedule states';
        deferred.reject(error);
      }
    });
    return deferred.promise;
  },

  wrap(deferred) {
    if (!deferred || !_.isFunction(deferred.then)) {
      return Promise.reject(new Error('Wrap cannot process this type of data into a ECMA promise'));
    }
    return new Promise((resolve, reject) => {
      deferred.then({
        success(...args) {
          resolve(...args);
        },
        failure(error) {
          Rally.getApp().setLoading(false);
          reject(error);
        },
        scope: this
      });
    });
  }
});
