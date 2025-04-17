'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('file_operations', 'error', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('file_operations', 'error', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  }
};
